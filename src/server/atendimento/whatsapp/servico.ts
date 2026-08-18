import { Prisma, type OrigemMensagem, type TipoMensagemWhats } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { montarMenuTexto, type OpcaoApresentada } from "../dominio/motor";
import { registrarLog } from "../servicos/logs";
import type {
  BotaoWhats,
  MensagemSaida,
  ResultadoEnvio,
  SecaoLista,
  WhatsAppProvider,
} from "./tipos";

/**
 * Camada única de saída do WhatsApp.
 *
 * Todo envio do sistema passa por aqui, e por três motivos:
 *
 * 1. **Fallback.** Botão e lista nativos não existem em todo provedor e nem
 *    sempre são entregues pela conta do WhatsApp. Quando falham, a mesma
 *    mensagem sai como menu numerado — o motor entende o número igual, então o
 *    fluxo continua em vez de travar.
 * 2. **Histórico.** A mensagem enviada é gravada na conversa, com erro
 *    incluído. O inbox mostra o que o cliente viu, não o que se pretendia
 *    enviar.
 * 3. **Retentativa.** Falha de rede não pode perder a mensagem.
 */

const TENTATIVAS = 3;
const ESPERA_BASE_MS = 400;

export interface ContextoEnvio {
  conversaId: string;
  /** Número do cliente, só dígitos. */
  destino: string;
  origem?: OrigemMensagem;
  /** Atendente humano, quando a mensagem não é do bot. */
  usuarioId?: string | null;
}

export class ServicoWhatsApp {
  constructor(private readonly provider: WhatsAppProvider) {}

  get nomeProvedor(): string {
    return this.provider.nome;
  }

  async sendText(contexto: ContextoEnvio, texto: string): Promise<ResultadoEnvio> {
    return this.despachar(contexto, { tipo: "texto", texto }, "TEXTO", texto);
  }

  /**
   * Botões nativos, limitados a três pelo WhatsApp. Acima disso, ou sem
   * suporte do provedor, vira menu numerado automaticamente.
   */
  async sendButtons(
    contexto: ContextoEnvio,
    texto: string,
    opcoes: readonly OpcaoApresentada[],
    extras: { titulo?: string; rodape?: string } = {},
  ): Promise<ResultadoEnvio> {
    const cabe = opcoes.length > 0 && opcoes.length <= 3 && this.provider.recursos.botoes;
    const alternativa = montarMenuTexto(texto, opcoes, extras.rodape);

    if (!cabe) return this.sendText(contexto, alternativa);

    const botoes: BotaoWhats[] = opcoes.map((opcao) => ({ id: opcao.id, rotulo: opcao.rotulo }));

    return this.despachar(
      contexto,
      { tipo: "botoes", texto, botoes, titulo: extras.titulo, rodape: extras.rodape },
      "BOTOES",
      alternativa,
      alternativa,
    );
  }

  /** Lista nativa, limitada a dez linhas. Acima disso, menu numerado. */
  async sendList(
    contexto: ContextoEnvio,
    texto: string,
    opcoes: readonly OpcaoApresentada[],
    extras: { titulo?: string; rotuloBotao?: string; rodape?: string } = {},
  ): Promise<ResultadoEnvio> {
    const cabe = opcoes.length > 0 && opcoes.length <= 10 && this.provider.recursos.listas;
    const alternativa = montarMenuTexto(texto, opcoes, extras.rodape);

    if (!cabe) return this.sendText(contexto, alternativa);

    const secoes: SecaoLista[] = [
      {
        titulo: extras.titulo ?? "Opções",
        itens: opcoes.map((opcao) => ({ id: opcao.id, titulo: opcao.rotulo })),
      },
    ];

    return this.despachar(
      contexto,
      {
        tipo: "lista",
        texto,
        secoes,
        titulo: extras.titulo,
        rodape: extras.rodape,
        rotuloBotao: extras.rotuloBotao ?? "Ver opções",
      },
      "LISTA",
      alternativa,
      alternativa,
    );
  }

  async sendImage(
    contexto: ContextoEnvio,
    url: string,
    legenda?: string,
  ): Promise<ResultadoEnvio> {
    if (!this.provider.recursos.midia) {
      return this.sendText(contexto, [legenda, url].filter(Boolean).join("\n"));
    }
    return this.despachar(contexto, { tipo: "imagem", url, legenda }, "IMAGEM", legenda ?? url);
  }

  async sendDocument(
    contexto: ContextoEnvio,
    url: string,
    nomeArquivo: string,
    legenda?: string,
  ): Promise<ResultadoEnvio> {
    if (!this.provider.recursos.midia) {
      return this.sendText(contexto, [legenda, url].filter(Boolean).join("\n"));
    }
    return this.despachar(
      contexto,
      { tipo: "documento", url, nomeArquivo, legenda },
      "DOCUMENTO",
      legenda ?? nomeArquivo,
    );
  }

  async sendAudio(contexto: ContextoEnvio, url: string): Promise<ResultadoEnvio> {
    if (!this.provider.recursos.audio) return this.sendText(contexto, url);
    return this.despachar(contexto, { tipo: "audio", url }, "AUDIO", url);
  }

  /** Template da API oficial. Sem suporte, cai no texto já montado. */
  async sendTemplate(
    contexto: ContextoEnvio,
    nome: string,
    idioma: string,
    parametros: string[],
    alternativa: string,
  ): Promise<ResultadoEnvio> {
    if (!this.provider.recursos.templates) return this.sendText(contexto, alternativa);

    return this.despachar(
      contexto,
      { tipo: "template", nome, idioma, parametros },
      "TEMPLATE",
      alternativa,
      alternativa,
    );
  }

  async markAsRead(destino: string, mensagemId: string | null): Promise<void> {
    if (!mensagemId || !this.provider.recursos.marcarLido) return;

    try {
      await this.provider.marcarComoLida(destino, mensagemId);
    } catch {
      // Marcar como lida é cosmético: nunca vale interromper o atendimento.
    }
  }

  /**
   * Envia, tenta de novo o que for temporário, cai para o texto alternativo
   * quando o formato rico falha e grava o resultado na conversa.
   */
  private async despachar(
    contexto: ContextoEnvio,
    mensagem: MensagemSaida,
    tipo: TipoMensagemWhats,
    conteudoRegistrado: string,
    alternativaTexto?: string,
  ): Promise<ResultadoEnvio> {
    const resultado = await this.tentar(contexto.destino, mensagem);

    if (!resultado.sucesso && alternativaTexto) {
      await registrarLog({
        tipo: "ERRO",
        conversaId: contexto.conversaId,
        descricao: `Envio ${tipo} falhou, caindo para texto: ${resultado.erro ?? "sem detalhe"}`,
      });
      return this.sendText(contexto, alternativaTexto);
    }

    await this.registrar(contexto, tipo, conteudoRegistrado, resultado);
    return resultado;
  }

  private async tentar(destino: string, mensagem: MensagemSaida): Promise<ResultadoEnvio> {
    let ultimo: ResultadoEnvio = { sucesso: false, erro: "não enviado" };

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
      ultimo = await this.provider.enviar(destino, mensagem);
      if (ultimo.sucesso || !ultimo.temporario) return ultimo;

      if (tentativa < TENTATIVAS) {
        await esperar(ESPERA_BASE_MS * 2 ** (tentativa - 1));
      }
    }

    return ultimo;
  }

  private async registrar(
    contexto: ContextoEnvio,
    tipo: TipoMensagemWhats,
    conteudo: string,
    resultado: ResultadoEnvio,
  ): Promise<void> {
    const linha = {
      conversaId: contexto.conversaId,
      origem: contexto.origem ?? "BOT",
      tipo,
      conteudo,
      usuarioId: contexto.usuarioId ?? null,
      erro: resultado.sucesso ? null : (resultado.erro ?? "falha no envio"),
    };

    try {
      try {
        await prisma.mensagemAtendimento.create({
          data: { ...linha, externoId: resultado.externoId ?? null },
        });
      } catch (erro) {
        // O `externoId` é único porque é ele que impede processar duas vezes o
        // mesmo webhook de ENTRADA. Se um provedor repetir o id numa mensagem
        // de saída, perder o id é aceitável; perder o registro da mensagem
        // enviada — que é o histórico mostrado no painel — não é.
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2002"
        ) {
          await prisma.mensagemAtendimento.create({ data: { ...linha, externoId: null } });
        } else {
          throw erro;
        }
      }

      await prisma.conversa.update({
        where: { id: contexto.conversaId },
        data: { ultimaMensagemEm: new Date() },
      });
    } catch (erro) {
      console.error("[atendimento] falha ao gravar mensagem enviada", erro);
    }

    await registrarLog({
      tipo: resultado.sucesso ? "MENSAGEM_ENVIADA" : "ERRO",
      conversaId: contexto.conversaId,
      descricao: resultado.sucesso
        ? `Mensagem ${tipo} enviada`
        : `Falha ao enviar mensagem ${tipo}: ${resultado.erro ?? "sem detalhe"}`,
    });
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

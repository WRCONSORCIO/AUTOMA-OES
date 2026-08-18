import type {
  EstadoConexao,
  MensagemRecebida,
  MensagemSaida,
  RecursosProvedor,
  ResultadoEnvio,
  WhatsAppProvider,
} from "./tipos";

/**
 * Provedor Evolution API (v2).
 *
 * Único arquivo do sistema que conhece as rotas da Evolution. Endpoints e
 * corpos seguem a referência da v2: `POST /message/sendText/{instância}` com
 * `{ number, text }`, `sendButtons` com `buttons[].{type,displayText,id}` e
 * `sendList` com `sections[].rows[].{title,description,rowId}`; a credencial
 * vai no cabeçalho `apikey`.
 *
 * Botão nativo depende da conta do WhatsApp e nem sempre é entregue. Por isso
 * o serviço acima trata falha de botão como caso normal e cai para o menu
 * numerado, em vez de deixar o cliente sem mensagem.
 */
export interface ConfiguracaoEvolution {
  apiUrl: string;
  apiKey: string;
  instancia: string;
  /** Tempo máximo por chamada. Evita segurar o webhook do WhatsApp. */
  timeoutMs?: number;
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly nome = "EVOLUTION";

  readonly recursos: RecursosProvedor = {
    botoes: true,
    listas: true,
    midia: true,
    audio: true,
    templates: false,
    marcarLido: true,
  };

  constructor(private readonly config: ConfiguracaoEvolution) {}

  async enviar(destino: string, mensagem: MensagemSaida): Promise<ResultadoEnvio> {
    switch (mensagem.tipo) {
      case "texto":
        return this.chamar(`/message/sendText/${this.instancia}`, {
          number: destino,
          text: mensagem.texto,
        });

      case "botoes":
        return this.chamar(`/message/sendButtons/${this.instancia}`, {
          number: destino,
          title: mensagem.titulo ?? "",
          description: mensagem.texto,
          footer: mensagem.rodape ?? "",
          buttons: mensagem.botoes.map((botao) => ({
            type: "reply",
            displayText: botao.rotulo,
            id: botao.id,
          })),
        });

      case "lista":
        return this.chamar(`/message/sendList/${this.instancia}`, {
          number: destino,
          title: mensagem.titulo ?? "",
          description: mensagem.texto,
          buttonText: mensagem.rotuloBotao,
          footerText: mensagem.rodape ?? "",
          sections: mensagem.secoes.map((secao) => ({
            title: secao.titulo,
            rows: secao.itens.map((item) => ({
              title: item.titulo,
              description: item.descricao ?? "",
              rowId: item.id,
            })),
          })),
        });

      case "imagem":
        return this.chamar(`/message/sendMedia/${this.instancia}`, {
          number: destino,
          mediatype: "image",
          media: mensagem.url,
          caption: mensagem.legenda ?? "",
        });

      case "documento":
        return this.chamar(`/message/sendMedia/${this.instancia}`, {
          number: destino,
          mediatype: "document",
          media: mensagem.url,
          fileName: mensagem.nomeArquivo,
          caption: mensagem.legenda ?? "",
        });

      case "audio":
        return this.chamar(`/message/sendWhatsAppAudio/${this.instancia}`, {
          number: destino,
          audio: mensagem.url,
        });

      case "template":
        // A Evolution não expõe template da API oficial. Quem chama trata o
        // `sucesso: false` caindo para texto — é o mesmo caminho do fallback
        // de botão.
        return { sucesso: false, erro: "Template não suportado pela Evolution API" };
    }
  }

  async marcarComoLida(destino: string, mensagemId: string): Promise<void> {
    await this.chamar(`/chat/markMessageAsRead/${this.instancia}`, {
      readMessages: [
        { remoteJid: `${destino}@s.whatsapp.net`, fromMe: false, id: mensagemId },
      ],
    });
  }

  async estadoConexao(): Promise<EstadoConexao> {
    try {
      const resposta = await fetch(
        `${this.base}/instance/connectionState/${this.instancia}`,
        { headers: { apikey: this.config.apiKey }, signal: this.abortar() },
      );

      if (!resposta.ok) {
        return { conectado: false, detalhe: `HTTP ${resposta.status}` };
      }

      const corpo = (await resposta.json()) as {
        instance?: { state?: string };
        state?: string;
      };
      const estado = corpo.instance?.state ?? corpo.state ?? "desconhecido";

      return { conectado: estado === "open", detalhe: estado };
    } catch (erro) {
      return { conectado: false, detalhe: mensagemDoErro(erro) };
    }
  }

  private get base(): string {
    return this.config.apiUrl.replace(/\/+$/, "");
  }

  private get instancia(): string {
    return encodeURIComponent(this.config.instancia);
  }

  private abortar(): AbortSignal {
    return AbortSignal.timeout(this.config.timeoutMs ?? 15_000);
  }

  private async chamar(caminho: string, corpo: unknown): Promise<ResultadoEnvio> {
    try {
      const resposta = await fetch(`${this.base}${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: this.config.apiKey },
        body: JSON.stringify(corpo),
        signal: this.abortar(),
      });

      const texto = await resposta.text();

      if (!resposta.ok) {
        return {
          sucesso: false,
          erro: `HTTP ${resposta.status}: ${texto.slice(0, 300)}`,
          // 4xx é erro de dados nossos e repetir não resolve; 5xx e 429 são
          // do outro lado e merecem nova tentativa.
          temporario: resposta.status >= 500 || resposta.status === 429,
        };
      }

      return { sucesso: true, externoId: extrairId(texto) };
    } catch (erro) {
      return { sucesso: false, erro: mensagemDoErro(erro), temporario: true };
    }
  }
}

function extrairId(texto: string): string | undefined {
  try {
    const corpo = JSON.parse(texto) as { key?: { id?: string } };
    return corpo.key?.id;
  } catch {
    return undefined;
  }
}

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Traduz o webhook da Evolution (`messages.upsert`) para o formato do sistema.
 *
 * Devolve `null` para o que não é conversa de cliente: grupo, status,
 * transmissão e mensagem enviada pela própria instância. Sem esse filtro, o
 * bot responderia a si mesmo em laço.
 */
export function lerWebhookEvolution(evento: unknown): MensagemRecebida | null {
  const raiz = evento as {
    event?: string;
    data?: Record<string, unknown> | Record<string, unknown>[];
  };

  const evento_ = raiz?.event?.toLowerCase().replace(".", "_");
  if (evento_ && evento_ !== "messages_upsert") return null;

  const dado = Array.isArray(raiz?.data) ? raiz.data[0] : raiz?.data;
  if (!dado) return null;

  const chave = dado.key as { id?: string; remoteJid?: string; fromMe?: boolean } | undefined;
  const remoteJid = chave?.remoteJid ?? "";

  if (!remoteJid || remoteJid.includes("@g.us") || remoteJid.includes("broadcast")) return null;

  const mensagem = (dado.message ?? {}) as Record<string, unknown>;

  const texto =
    (mensagem.conversation as string | undefined) ??
    ((mensagem.extendedTextMessage as { text?: string } | undefined)?.text ?? "") ??
    "";

  const respostaBotao =
    (mensagem.buttonsResponseMessage as { selectedButtonId?: string } | undefined)
      ?.selectedButtonId ??
    (mensagem.templateButtonReplyMessage as { selectedId?: string } | undefined)?.selectedId ??
    (mensagem.listResponseMessage as
      | { singleSelectReply?: { selectedRowId?: string } }
      | undefined)?.singleSelectReply?.selectedRowId ??
    (mensagem.interactiveResponseMessage as { nativeFlowResponseMessage?: { paramsJson?: string } }
      | undefined)?.nativeFlowResponseMessage?.paramsJson ??
    null;

  const rotuloBotao =
    (mensagem.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)
      ?.selectedDisplayText ??
    (mensagem.listResponseMessage as { title?: string } | undefined)?.title ??
    null;

  const carimbo = Number(dado.messageTimestamp ?? 0);

  return {
    externoId: chave?.id ?? null,
    telefone: remoteJid,
    nomeContato: (dado.pushName as string | undefined) ?? null,
    texto: texto || rotuloBotao || "",
    respostaSelecionada: idDaResposta(respostaBotao),
    recebidaEm: carimbo > 0 ? new Date(carimbo * 1000) : new Date(),
    daPropriaInstancia: chave?.fromMe === true,
  };
}

/**
 * O `paramsJson` do botão nativo novo vem como JSON com o id dentro. Os demais
 * formatos já entregam o id direto.
 */
function idDaResposta(valor: string | null): string | null {
  if (!valor) return null;
  if (!valor.trim().startsWith("{")) return valor;

  try {
    const corpo = JSON.parse(valor) as { id?: string; selectedId?: string };
    return corpo.id ?? corpo.selectedId ?? null;
  } catch {
    return null;
  }
}

import type {
  Aparelho,
  ClienteAtendimento,
  Conversa,
  EtapaFluxo,
  Plano,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarMoeda } from "@/lib/format";
import { interpretarEscolha, type Escolha, type OpcaoApresentada } from "../dominio/motor";
import { dentroDoHorario, descreverHorarios } from "../dominio/horario";
import type { Variaveis } from "../dominio/variaveis";
import { aplicarVariaveis } from "../dominio/variaveis";
import { registrarLog } from "../servicos/logs";
import { textoDaMensagem } from "../servicos/mensagens";
import { criarOuReaproveitarPedido } from "../servicos/pedidos";
import {
  conversaAtiva,
  gravarContexto,
  gravarHistorico,
  lerContexto,
  lerHistorico,
  moverParaEtapa,
} from "../servicos/conversas";
import { localizarOuCriarCliente } from "../servicos/clientes";
import { resolverProvedorWhatsApp } from "../whatsapp/fabrica";
import { ServicoWhatsApp } from "../whatsapp/servico";
import type { MensagemRecebida } from "../whatsapp/tipos";
import { obterProvedorPagamento } from "../pagamentos/fabrica";
import {
  lerConfig,
  opcoesDaEtapa,
  PREFIXO_APARELHO,
  PREFIXO_PLANO,
  type EtapaComOpcoes,
} from "./opcoes";

/**
 * Máquina de estados do atendimento.
 *
 * O fluxo inteiro vem do banco: etapas, opções, mensagens e destinos são
 * configurados no painel. Este arquivo sabe apenas **como** executar uma etapa,
 * nunca **qual** etapa existe — é o que permite mudar o atendimento sem deploy.
 *
 * Três invariantes que o resto do módulo depende:
 *
 * 1. O estado mora no PostgreSQL. Cada avanço é uma escrita; reiniciar o
 *    processo não perde onde o cliente estava.
 * 2. Pagamento só avança por confirmação do gateway. "Paguei" digitado pelo
 *    cliente não move nada.
 * 3. Conversa em atendimento humano silencia o bot por completo.
 */

/** Trava contra fluxo mal configurado que aponta para si mesmo. */
const MAXIMO_ETAPAS_SEGUIDAS = 12;

const RODAPE_NAVEGACAO = "Responda *voltar*, *menu* ou *atendente* quando precisar.";

interface Sessao {
  conversa: Conversa;
  cliente: ClienteAtendimento;
  servico: ServicoWhatsApp;
  destino: string;
}

// ---------------------------------------------------------------------------
// Entrada: mensagem recebida do WhatsApp
// ---------------------------------------------------------------------------

export async function processarMensagemRecebida(
  recebida: MensagemRecebida,
  instanciaId?: string | null,
): Promise<void> {
  // Mensagem que a própria instância enviou volta no webhook de alguns
  // provedores. Responder a ela faria o bot conversar sozinho.
  if (recebida.daPropriaInstancia) return;

  if (recebida.externoId) {
    const jaProcessada = await prisma.mensagemAtendimento.findUnique({
      where: { externoId: recebida.externoId },
      select: { id: true },
    });
    // Webhook repetido: o provedor reentrega quando não recebe 200 a tempo.
    if (jaProcessada) return;
  }

  const cliente = await localizarOuCriarCliente(recebida.telefone, {
    nome: recebida.nomeContato,
    whatsappId: recebida.telefone.includes("@") ? recebida.telefone : null,
  });
  if (!cliente) return;

  const conversa = await conversaAtiva(cliente.id, instanciaId);

  await prisma.mensagemAtendimento.create({
    data: {
      conversaId: conversa.id,
      origem: "CLIENTE",
      tipo: "TEXTO",
      conteudo: recebida.texto,
      externoId: recebida.externoId,
      metadados: recebida.respostaSelecionada
        ? { respostaSelecionada: recebida.respostaSelecionada }
        : undefined,
    },
  });

  await prisma.clienteAtendimento.update({
    where: { id: cliente.id },
    data: { ultimaInteracaoEm: new Date() },
  });
  await prisma.conversa.update({
    where: { id: conversa.id },
    data: { ultimaMensagemEm: new Date() },
  });

  await registrarLog({
    tipo: "MENSAGEM_RECEBIDA",
    conversaId: conversa.id,
    clienteId: cliente.id,
    descricao: `Mensagem recebida de ${cliente.telefoneExibicao}`,
  });

  const { provider } = await resolverProvedorWhatsApp(conversa.instanciaId ?? instanciaId);
  const servico = new ServicoWhatsApp(provider);
  await servico.markAsRead(cliente.telefone, recebida.externoId);

  // Atendente assumiu: o bot não responde nada até ser devolvido.
  if (conversa.status === "HUMAN") return;

  const sessao: Sessao = { conversa, cliente, servico, destino: cliente.telefone };
  const entrada = recebida.respostaSelecionada?.trim() || recebida.texto;

  try {
    await responder(sessao, entrada);
  } catch (erro) {
    console.error("[atendimento] falha ao processar mensagem", erro);

    await registrarLog({
      tipo: "ERRO",
      conversaId: conversa.id,
      clienteId: cliente.id,
      descricao: `Falha ao processar mensagem: ${erro instanceof Error ? erro.message : "desconhecida"}`,
    });

    await sessao.servico.sendText(
      contextoEnvio(sessao),
      await textoDaMensagem("erro", await variaveis(sessao)),
    );
  }
}

/**
 * Decide o que a resposta do cliente significa e executa.
 *
 * A ordem importa: opção configurada vence comando global, para que um botão
 * "Falar com atendente" desenhado pelo administrador siga o destino dele.
 */
async function responder(sessao: Sessao, entrada: string): Promise<void> {
  const etapa = await etapaAtual(sessao.conversa);

  if (!etapa) {
    await iniciarFluxoPrincipal(sessao);
    return;
  }

  const opcoes = await opcoesDaEtapa(etapa);
  const escolha = interpretarEscolha(entrada, opcoes);

  if (escolha.tipo === "comando") {
    await executarComando(sessao, escolha.comando);
    return;
  }

  if (escolha.tipo === "opcao") {
    await aplicarEscolha(sessao, etapa, escolha);
    return;
  }

  await respostaNaoReconhecida(sessao, etapa, entrada, opcoes);
}

async function executarComando(
  sessao: Sessao,
  comando: "menu" | "voltar" | "atendente",
): Promise<void> {
  if (comando === "menu") {
    await iniciarFluxoPrincipal(sessao, { reiniciarContexto: false });
    return;
  }

  if (comando === "atendente") {
    await transferirParaHumano(sessao);
    return;
  }

  await voltarEtapa(sessao);
}

/**
 * Volta de verdade: desempilha o histórico e reapresenta a etapa anterior.
 *
 * Sem histórico, o único lugar coerente para voltar é o menu inicial.
 */
async function voltarEtapa(sessao: Sessao): Promise<void> {
  const historico = lerHistorico(sessao.conversa);
  const anteriorId = historico.at(-1);

  if (!anteriorId) {
    await iniciarFluxoPrincipal(sessao, { reiniciarContexto: false });
    return;
  }

  const anterior = await prisma.etapaFluxo.findUnique({
    where: { id: anteriorId },
    include: { opcoes: true },
  });

  if (!anterior) {
    await iniciarFluxoPrincipal(sessao, { reiniciarContexto: false });
    return;
  }

  sessao.conversa = await gravarHistorico(sessao.conversa, historico.slice(0, -1));
  sessao.conversa = await moverParaEtapa(
    sessao.conversa,
    { fluxoId: anterior.fluxoId, etapaId: anterior.id },
    { empilharAtual: false },
  );

  await entrarNaEtapa(sessao, anterior);
}

async function aplicarEscolha(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  escolha: Extract<Escolha, { tipo: "opcao" }>,
): Promise<void> {
  const contexto = lerContexto(sessao.conversa);
  const id = escolha.opcao.id;

  if (id.startsWith(PREFIXO_PLANO)) {
    await escolherPlano(sessao, etapa, id.slice(PREFIXO_PLANO.length), contexto);
    return;
  }

  if (id.startsWith(PREFIXO_APARELHO)) {
    await escolherAparelho(sessao, etapa, id.slice(PREFIXO_APARELHO.length), contexto);
    return;
  }

  const opcao = etapa.opcoes.find((item) => item.id === id);
  if (!opcao) {
    await respostaNaoReconhecida(sessao, etapa, escolha.opcao.valor, await opcoesDaEtapa(etapa));
    return;
  }

  contexto[etapa.chave] = opcao.valor;
  if (opcao.planoId) contexto.planoId = opcao.planoId;
  if (opcao.aparelhoId) contexto.aparelhoId = opcao.aparelhoId;

  await registrarLog({
    tipo: "MUDANCA_ETAPA",
    conversaId: sessao.conversa.id,
    clienteId: sessao.cliente.id,
    descricao: `Escolheu "${opcao.rotulo}" na etapa ${etapa.nome}`,
  });

  await seguirPara(sessao, etapa, contexto, {
    etapaId: opcao.proximaEtapaId,
    fluxoId: opcao.proximoFluxoId,
  });
}

async function escolherPlano(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  planoId: string,
  contexto: Record<string, unknown>,
): Promise<void> {
  const plano = await prisma.plano.findUnique({ where: { id: planoId } });

  if (!plano || plano.status !== "ATIVO") {
    await respostaNaoReconhecida(sessao, etapa, "", await opcoesDaEtapa(etapa));
    return;
  }

  contexto.planoId = plano.id;
  contexto.planoNome = plano.nome;
  contexto.planoPreco = formatarMoeda(Number(plano.preco));
  contexto.planoDuracao = plano.duracaoDias;

  await registrarLog({
    tipo: "MUDANCA_ETAPA",
    conversaId: sessao.conversa.id,
    clienteId: sessao.cliente.id,
    descricao: `Escolheu o plano ${plano.nome}`,
  });

  await seguirPara(sessao, etapa, contexto, {
    etapaId: etapa.proximaEtapaId,
    fluxoId: etapa.proximoFluxoId,
  });
}

/**
 * Escolha do aparelho.
 *
 * Com fluxo próprio, o cliente entra nele. Sem fluxo, o bot envia as instruções
 * cadastradas no aparelho e segue para a etapa seguinte do fluxo atual.
 */
async function escolherAparelho(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  aparelhoId: string,
  contexto: Record<string, unknown>,
): Promise<void> {
  const aparelho = await prisma.aparelho.findUnique({ where: { id: aparelhoId } });

  if (!aparelho || aparelho.status !== "ATIVO") {
    await respostaNaoReconhecida(sessao, etapa, "", await opcoesDaEtapa(etapa));
    return;
  }

  contexto.aparelhoId = aparelho.id;
  contexto.aparelhoNome = aparelho.nome;
  contexto.aparelhoChave = aparelho.chave;

  await registrarLog({
    tipo: "MUDANCA_ETAPA",
    conversaId: sessao.conversa.id,
    clienteId: sessao.cliente.id,
    descricao: `Escolheu o aparelho ${aparelho.nome}`,
  });

  if (aparelho.fluxoId) {
    await seguirPara(sessao, etapa, contexto, { etapaId: null, fluxoId: aparelho.fluxoId });
    return;
  }

  await enviarInstrucoesDoAparelho(sessao, aparelho, contexto);

  await seguirPara(sessao, etapa, contexto, {
    etapaId: etapa.proximaEtapaId,
    fluxoId: etapa.proximoFluxoId,
  });
}

async function enviarInstrucoesDoAparelho(
  sessao: Sessao,
  aparelho: Aparelho,
  contexto: Record<string, unknown>,
): Promise<void> {
  const vars = await variaveis(sessao, contexto);
  const cabecalho = await textoDaMensagem("instrucoes", vars);
  const corpo = aparelho.instrucoes?.trim();

  const texto = [cabecalho, corpo ? aplicarVariaveis(corpo, vars) : ""]
    .filter(Boolean)
    .join("\n\n");

  if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);
}

/** Resposta fora do esperado: repete o menu em vez de quebrar o atendimento. */
async function respostaNaoReconhecida(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  entrada: string,
  opcoes: OpcaoApresentada[],
): Promise<void> {
  // INPUT aceita qualquer texto: não existe "opção inválida" aqui.
  if (etapa.tipo === "INPUT") {
    const contexto = lerContexto(sessao.conversa);
    const variavel = lerConfig(etapa).variavel ?? etapa.chave;
    contexto[variavel] = entrada;

    await seguirPara(sessao, etapa, contexto, {
      etapaId: etapa.proximaEtapaId,
      fluxoId: etapa.proximoFluxoId,
    });
    return;
  }

  // Enquanto o pagamento não é confirmado pelo gateway, qualquer texto — "já
  // paguei" inclusive — recebe a mesma resposta: estamos aguardando. É aqui que
  // a regra "cliente não marca pagamento" encosta no atendimento.
  if (etapa.tipo === "PAYMENT_STATUS") {
    await entrarNaEtapa(sessao, etapa, { forcarMensagem: true });
    return;
  }

  const vars = await variaveis(sessao);
  const aviso = await textoDaMensagem("opcao_invalida", vars);

  if (aviso) await sessao.servico.sendText(contextoEnvio(sessao), aviso);
  await apresentarEtapa(sessao, etapa, opcoes);
}

// ---------------------------------------------------------------------------
// Navegação entre etapas
// ---------------------------------------------------------------------------

interface Destino {
  etapaId?: string | null;
  fluxoId?: string | null;
}

/**
 * Aplica o destino configurado.
 *
 * Salto para outro fluxo tem precedência sobre a próxima etapa: é assim que o
 * menu principal entrega o cliente para a contratação e o aparelho entrega para
 * o fluxo dele.
 */
async function seguirPara(
  sessao: Sessao,
  etapaOrigem: EtapaFluxo,
  contexto: Record<string, unknown>,
  destino: Destino,
): Promise<void> {
  sessao.conversa = await gravarContexto(sessao.conversa, contexto);

  if (destino.fluxoId) {
    const fluxo = await prisma.fluxo.findUnique({
      where: { id: destino.fluxoId },
      include: { etapaInicial: { include: { opcoes: true } } },
    });

    if (fluxo?.etapaInicial) {
      sessao.conversa = await moverParaEtapa(sessao.conversa, {
        fluxoId: fluxo.id,
        etapaId: fluxo.etapaInicial.id,
      });
      await entrarNaEtapa(sessao, fluxo.etapaInicial);
      return;
    }
  }

  if (destino.etapaId) {
    const proxima = await prisma.etapaFluxo.findUnique({
      where: { id: destino.etapaId },
      include: { opcoes: true },
    });

    if (proxima) {
      sessao.conversa = await moverParaEtapa(sessao.conversa, {
        fluxoId: proxima.fluxoId,
        etapaId: proxima.id,
      });
      await entrarNaEtapa(sessao, proxima);
      return;
    }
  }

  // Sem destino configurado, o fluxo acabou. Encerrar é melhor do que deixar o
  // cliente parado numa etapa que não responde mais.
  await encerrarConversa(sessao, etapaOrigem);
}

/**
 * Executa uma etapa e as seguintes que não exigem resposta.
 *
 * Etapas de texto encadeiam sozinhas; etapas que perguntam algo param e
 * esperam. O contador de segurança evita que um fluxo circular mal configurado
 * mande mensagens infinitas para o cliente.
 */
async function entrarNaEtapa(
  sessao: Sessao,
  etapaInicial: EtapaComOpcoes,
  opcoes: { forcarMensagem?: boolean; silenciosa?: boolean } = {},
): Promise<void> {
  let etapa: EtapaComOpcoes | null = etapaInicial;
  let passos = 0;

  while (etapa && passos < MAXIMO_ETAPAS_SEGUIDAS) {
    passos += 1;

    const resultado: ResultadoEtapa = await executarEtapa(sessao, etapa, {
      forcarMensagem: opcoes.forcarMensagem && passos === 1,
      silenciosa: opcoes.silenciosa && passos === 1,
    });

    if (resultado.aguardar) return;

    const proxima: string | null = resultado.proximaEtapaId ?? etapa.proximaEtapaId;
    const proximoFluxo: string | null = resultado.proximoFluxoId ?? etapa.proximoFluxoId;

    if (proximoFluxo) {
      const fluxo: { id: string; etapaInicial: EtapaComOpcoes | null } | null =
        await prisma.fluxo.findUnique({
          where: { id: proximoFluxo },
          include: { etapaInicial: { include: { opcoes: true } } },
        });

      if (fluxo?.etapaInicial) {
        sessao.conversa = await moverParaEtapa(sessao.conversa, {
          fluxoId: fluxo.id,
          etapaId: fluxo.etapaInicial.id,
        });
        etapa = fluxo.etapaInicial;
        continue;
      }
    }

    if (!proxima) {
      await encerrarConversa(sessao, etapa);
      return;
    }

    const seguinte: EtapaComOpcoes | null = await prisma.etapaFluxo.findUnique({
      where: { id: proxima },
      include: { opcoes: true },
    });

    if (!seguinte) {
      await encerrarConversa(sessao, etapa);
      return;
    }

    sessao.conversa = await moverParaEtapa(sessao.conversa, {
      fluxoId: seguinte.fluxoId,
      etapaId: seguinte.id,
    });
    etapa = seguinte;
  }

  if (passos >= MAXIMO_ETAPAS_SEGUIDAS) {
    await registrarLog({
      tipo: "ERRO",
      conversaId: sessao.conversa.id,
      clienteId: sessao.cliente.id,
      descricao: `Fluxo interrompido: mais de ${MAXIMO_ETAPAS_SEGUIDAS} etapas seguidas sem parar. Verifique se há laço na configuração.`,
    });
  }
}

interface ResultadoEtapa {
  /** `true` quando a etapa espera resposta do cliente ou encerra o fluxo. */
  aguardar: boolean;
  proximaEtapaId?: string | null;
  proximoFluxoId?: string | null;
}

async function executarEtapa(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  modo: { forcarMensagem?: boolean; silenciosa?: boolean } = {},
): Promise<ResultadoEtapa> {
  const config = lerConfig(etapa);

  switch (etapa.tipo) {
    case "TEXT": {
      if (!modo.silenciosa) await enviarMensagemDaEtapa(sessao, etapa);
      return { aguardar: false };
    }

    case "MENU":
    case "BUTTONS":
    case "LIST":
    case "DEVICE_SELECTION": {
      const opcoes = await opcoesDaEtapa(etapa);

      if (opcoes.length === 0) {
        // Etapa de escolha sem nada para escolher (nenhum plano ativo, por
        // exemplo). Seguir adiante esconderia o problema do administrador.
        await registrarLog({
          tipo: "ERRO",
          conversaId: sessao.conversa.id,
          clienteId: sessao.cliente.id,
          descricao: `Etapa ${etapa.nome} não tem opções disponíveis.`,
        });
        await transferirParaHumano(sessao);
        return { aguardar: true };
      }

      await apresentarEtapa(sessao, etapa, opcoes);
      return { aguardar: true };
    }

    case "INPUT": {
      await enviarMensagemDaEtapa(sessao, etapa);
      return { aguardar: true };
    }

    case "PAYMENT":
      return cobrar(sessao, etapa);

    case "PAYMENT_STATUS":
      return conferirPagamento(sessao, etapa, Boolean(modo.forcarMensagem));

    case "HUMAN_HANDOFF": {
      await transferirParaHumano(sessao, etapa.mensagem);
      return { aguardar: true };
    }

    case "END": {
      await enviarMensagemDaEtapa(sessao, etapa);
      await fecharConversa(sessao);
      return { aguardar: true };
    }

    default: {
      void config;
      return { aguardar: false };
    }
  }
}

async function apresentarEtapa(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  opcoes: OpcaoApresentada[],
): Promise<void> {
  const config = lerConfig(etapa);
  const texto = await renderizar(sessao, etapa.mensagem);
  const rodape = config.rodape ?? RODAPE_NAVEGACAO;
  const contexto = contextoEnvio(sessao);

  if (etapa.tipo === "LIST" || etapa.tipo === "DEVICE_SELECTION" || opcoes.length > 3) {
    await sessao.servico.sendList(contexto, texto, opcoes, {
      titulo: config.titulo,
      rotuloBotao: config.rotuloBotao,
      rodape,
    });
    return;
  }

  await sessao.servico.sendButtons(contexto, texto, opcoes, { titulo: config.titulo, rodape });
}

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------

/**
 * Cria a cobrança e envia o link.
 *
 * A conversa passa para `WAITING_PAYMENT` e para de avançar: quem a destrava é
 * o webhook do gateway, em `continuarAposPagamento`.
 */
async function cobrar(sessao: Sessao, etapa: EtapaComOpcoes): Promise<ResultadoEtapa> {
  const contexto = lerContexto(sessao.conversa);
  const planoId = typeof contexto.planoId === "string" ? contexto.planoId : null;
  const plano = planoId ? await prisma.plano.findUnique({ where: { id: planoId } }) : null;

  if (!plano) {
    await registrarLog({
      tipo: "ERRO",
      conversaId: sessao.conversa.id,
      clienteId: sessao.cliente.id,
      descricao: "Etapa de pagamento alcançada sem plano escolhido.",
    });
    await transferirParaHumano(sessao);
    return { aguardar: true };
  }

  const fluxo = await prisma.fluxo.findUnique({ where: { id: etapa.fluxoId } });
  const tipo = fluxo?.tipo === "RENOVACAO" ? "RENOVACAO" : "NOVA_CONTRATACAO";

  const cobranca = await criarOuReaproveitarPedido(sessao.conversa, plano, tipo);

  contexto.pedidoId = cobranca.pedido.id;
  contexto.pedidoNumero = cobranca.pedido.numero;
  sessao.conversa = await gravarContexto(sessao.conversa, contexto);

  if (!cobranca.link) {
    const motivo = cobranca.gatewayConfigurado
      ? "Falha ao gerar a cobrança no gateway."
      : "Gateway de pagamento não configurado.";

    await registrarLog({
      tipo: "ERRO",
      conversaId: sessao.conversa.id,
      clienteId: sessao.cliente.id,
      descricao: `${motivo} Pedido #${cobranca.pedido.numero}`,
    });

    await sessao.servico.sendText(
      contextoEnvio(sessao),
      await textoDaMensagem("erro", await variaveis(sessao, contexto)),
    );
    await transferirParaHumano(sessao);
    return { aguardar: true };
  }

  contexto.linkPagamento = cobranca.link;
  sessao.conversa = await gravarContexto(sessao.conversa, contexto);

  await enviarMensagemDaEtapa(sessao, etapa, contexto);

  sessao.conversa = await prisma.conversa.update({
    where: { id: sessao.conversa.id },
    data: { status: "WAITING_PAYMENT" },
  });

  await registrarLog({
    tipo: "PAGAMENTO",
    conversaId: sessao.conversa.id,
    clienteId: sessao.cliente.id,
    descricao: `Link de pagamento enviado para o pedido #${cobranca.pedido.numero}`,
  });

  // Move para a etapa de espera sem reenviar mensagem: o link acabou de sair.
  if (etapa.proximaEtapaId) {
    const espera = await prisma.etapaFluxo.findUnique({
      where: { id: etapa.proximaEtapaId },
      include: { opcoes: true },
    });

    if (espera) {
      sessao.conversa = await moverParaEtapa(sessao.conversa, {
        fluxoId: espera.fluxoId,
        etapaId: espera.id,
      });
    }
  }

  return { aguardar: true };
}

/**
 * Etapa de espera do pagamento.
 *
 * Consulta o gateway — nunca o cliente. Se o gateway já confirmou (o webhook
 * pode ter falhado), o fluxo segue; caso contrário repete a mensagem de espera.
 */
async function conferirPagamento(
  sessao: Sessao,
  etapa: EtapaComOpcoes,
  forcarMensagem: boolean,
): Promise<ResultadoEtapa> {
  const contexto = lerContexto(sessao.conversa);
  const pedidoId = typeof contexto.pedidoId === "string" ? contexto.pedidoId : null;

  const pedido = pedidoId
    ? await prisma.pedido.findUnique({
        where: { id: pedidoId },
        include: { pagamentos: { orderBy: { criadoEm: "desc" }, take: 1 } },
      })
    : null;

  if (pedido?.status === "PAID") return { aguardar: false };

  const cobranca = pedido?.pagamentos[0];
  if (cobranca) {
    const provedor = await obterProvedorPagamento();

    if (provedor.configurado && provedor.nome === cobranca.provedor) {
      const situacao = await provedor.getPayment(cobranca.externoId);

      if (situacao?.status === "PAID") {
        // Confirmação veio do gateway, não do cliente: pode liberar.
        const { confirmarPagamento } = await import("./pagamento");
        await confirmarPagamento(pedido.id, situacao.pagoEm ?? new Date(), {
          origem: "consulta",
        });
        return { aguardar: true };
      }
    }
  }

  if (forcarMensagem || !contexto.esperaAvisada) {
    contexto.esperaAvisada = true;
    sessao.conversa = await gravarContexto(sessao.conversa, contexto);
    await enviarMensagemDaEtapa(sessao, etapa, contexto);
  }

  return { aguardar: true };
}

// ---------------------------------------------------------------------------
// Atendimento humano e encerramento
// ---------------------------------------------------------------------------

export async function transferirParaHumano(
  sessao: Sessao,
  mensagemPersonalizada?: string,
): Promise<void> {
  const horarios = await prisma.horarioAtendimento.findMany({ orderBy: { diaSemana: "asc" } });
  const aberto = dentroDoHorario(horarios, new Date());
  const vars = await variaveis(sessao);

  const texto = aberto
    ? mensagemPersonalizada
      ? aplicarVariaveis(mensagemPersonalizada, vars)
      : await textoDaMensagem("atendimento_humano", vars)
    : await textoDaMensagem("fora_do_horario", vars);

  if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);

  sessao.conversa = await prisma.conversa.update({
    where: { id: sessao.conversa.id },
    data: { status: "HUMAN" },
  });

  await registrarLog({
    tipo: "TRANSFERENCIA_HUMANA",
    conversaId: sessao.conversa.id,
    clienteId: sessao.cliente.id,
    descricao: aberto
      ? "Conversa transferida para atendimento humano"
      : "Conversa transferida para atendimento humano fora do horário",
  });
}

async function encerrarConversa(sessao: Sessao, etapa: EtapaFluxo): Promise<void> {
  if (etapa.tipo !== "END") {
    const texto = await textoDaMensagem("encerramento", await variaveis(sessao));
    if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);
  }

  await fecharConversa(sessao);
}

async function fecharConversa(sessao: Sessao): Promise<void> {
  sessao.conversa = await prisma.conversa.update({
    where: { id: sessao.conversa.id },
    data: { status: "CLOSED", encerradaEm: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Início do fluxo
// ---------------------------------------------------------------------------

async function iniciarFluxoPrincipal(
  sessao: Sessao,
  opcoes: { reiniciarContexto?: boolean } = {},
): Promise<void> {
  const fluxo = await prisma.fluxo.findFirst({
    where: { tipo: "PRINCIPAL", status: "ATIVO" },
    orderBy: { criadoEm: "asc" },
    include: { etapaInicial: { include: { opcoes: true } } },
  });

  if (!fluxo?.etapaInicial) {
    await registrarLog({
      tipo: "ERRO",
      conversaId: sessao.conversa.id,
      clienteId: sessao.cliente.id,
      descricao: "Nenhum fluxo principal ativo com etapa inicial configurada.",
    });
    await transferirParaHumano(sessao);
    return;
  }

  const contexto = opcoes.reiniciarContexto === false ? lerContexto(sessao.conversa) : {};

  sessao.conversa = await prisma.conversa.update({
    where: { id: sessao.conversa.id },
    data: {
      status: "BOT",
      fluxoId: fluxo.id,
      etapaId: fluxo.etapaInicial.id,
      historicoEtapas: [],
      contexto: contexto as never,
    },
  });

  await entrarNaEtapa(sessao, fluxo.etapaInicial);
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

async function etapaAtual(conversa: Conversa): Promise<EtapaComOpcoes | null> {
  if (!conversa.etapaId) return null;
  return prisma.etapaFluxo.findUnique({
    where: { id: conversa.etapaId },
    include: { opcoes: true },
  });
}

async function enviarMensagemDaEtapa(
  sessao: Sessao,
  etapa: EtapaFluxo,
  contexto?: Record<string, unknown>,
): Promise<void> {
  const texto = await renderizar(sessao, etapa.mensagem, contexto);
  if (texto.trim()) await sessao.servico.sendText(contextoEnvio(sessao), texto);
}

async function renderizar(
  sessao: Sessao,
  texto: string,
  contexto?: Record<string, unknown>,
): Promise<string> {
  return aplicarVariaveis(texto, await variaveis(sessao, contexto));
}

/** Variáveis disponíveis para todas as mensagens do atendimento. */
async function variaveis(
  sessao: Sessao,
  contextoExplicito?: Record<string, unknown>,
): Promise<Variaveis> {
  const contexto = contextoExplicito ?? lerContexto(sessao.conversa);
  const horarios = await prisma.horarioAtendimento.findMany({ orderBy: { diaSemana: "asc" } });

  return {
    customer_name: sessao.cliente.nome ?? "",
    plan_name: texto(contexto.planoNome),
    plan_price: texto(contexto.planoPreco),
    plan_duration: texto(contexto.planoDuracao),
    payment_link: texto(contexto.linkPagamento),
    order_id: texto(contexto.pedidoNumero),
    device_name: texto(contexto.aparelhoNome),
    business_hours: descreverHorarios(horarios),
  };
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor);
}

function contextoEnvio(sessao: Sessao) {
  return { conversaId: sessao.conversa.id, destino: sessao.destino };
}

/** Sessão montada a partir da conversa — usada pelo webhook de pagamento. */
export async function abrirSessao(conversaId: string): Promise<Sessao | null> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { cliente: true },
  });
  if (!conversa) return null;

  const { provider } = await resolverProvedorWhatsApp(conversa.instanciaId);

  return {
    conversa,
    cliente: conversa.cliente,
    servico: new ServicoWhatsApp(provider),
    destino: conversa.cliente.telefone,
  };
}

export type { Sessao };
export { entrarNaEtapa, etapaAtual, variaveis, contextoEnvio, renderizar };
export type { Plano };

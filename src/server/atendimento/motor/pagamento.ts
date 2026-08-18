import type { StatusPagamento } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarLog } from "../servicos/logs";
import { textoDaMensagem } from "../servicos/mensagens";
import { registrarHistorico } from "../servicos/pedidos";
import { lerContexto } from "../servicos/conversas";
import {
  abrirSessao,
  contextoEnvio,
  entrarNaEtapa,
  etapaAtual,
  variaveis,
} from "./executor";

/**
 * Continuação do atendimento a partir do que o gateway confirmou.
 *
 * Só este arquivo muda um pedido para `PAID`, e só é chamado por webhook
 * validado ou por consulta direta ao gateway. Nenhum caminho parte de texto
 * escrito pelo cliente — é a regra central do módulo.
 *
 * Idempotente por construção: pedido já pago devolve `false` e não reenvia
 * mensagem. Webhook repetido não libera duas vezes nem duplica conversa.
 */

export interface ResultadoConfirmacao {
  /** `true` quando esta chamada foi a que mudou o pedido. */
  aplicado: boolean;
  motivo?: string;
}

export async function confirmarPagamento(
  pedidoId: string,
  pagoEm: Date,
  opcoes: { origem: "webhook" | "consulta" | "painel"; usuarioId?: string | null } = {
    origem: "webhook",
  },
): Promise<ResultadoConfirmacao> {
  // A troca de status é condicional na própria consulta: dois webhooks
  // simultâneos não conseguem os dois marcar como pago.
  const atualizados = await prisma.pedido.updateMany({
    where: { id: pedidoId, status: { notIn: ["PAID", "REFUNDED"] } },
    data: { status: "PAID", pagoEm },
  });

  if (atualizados.count === 0) {
    return { aplicado: false, motivo: "Pedido já estava pago ou estornado." };
  }

  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: { plano: true },
  });
  if (!pedido) return { aplicado: false, motivo: "Pedido não encontrado." };

  await prisma.pagamento.updateMany({
    where: { pedidoId, status: { notIn: ["PAID", "REFUNDED"] } },
    data: { status: "PAID" },
  });

  await registrarHistorico(
    pedidoId,
    "PENDING",
    "PAID",
    `Pagamento confirmado pelo gateway (${opcoes.origem})`,
    opcoes.usuarioId,
  );

  await registrarLog({
    tipo: "PAGAMENTO",
    conversaId: pedido.conversaId,
    clienteId: pedido.clienteId,
    descricao: `Pedido #${pedido.numero} confirmado como pago (${opcoes.origem})`,
    dados: { pedidoId, planoId: pedido.planoId },
  });

  if (pedido.conversaId) await continuarConversa(pedido.conversaId);

  return { aplicado: true };
}

/**
 * Retoma o atendimento da conversa que estava esperando o pagamento.
 *
 * A conversa volta para o bot e avança para a etapa seguinte à de espera — que
 * é onde o administrador configurou a mensagem de confirmação e a escolha do
 * aparelho. Se a conversa já tinha sido assumida por um atendente, o bot não
 * interrompe: quem está com o cliente é a pessoa.
 */
async function continuarConversa(conversaId: string): Promise<void> {
  const sessao = await abrirSessao(conversaId);
  if (!sessao) return;

  if (sessao.conversa.status === "HUMAN") {
    await registrarLog({
      tipo: "PAGAMENTO",
      conversaId,
      descricao: "Pagamento confirmado durante atendimento humano: bot não retomou o fluxo.",
    });
    return;
  }

  if (sessao.conversa.status === "CLOSED") return;

  sessao.conversa = await prisma.conversa.update({
    where: { id: conversaId },
    data: { status: "BOT" },
  });

  const etapa = await etapaAtual(sessao.conversa);

  // Fora de uma etapa de pagamento não há "próxima" evidente: avisa e para,
  // em vez de empurrar o cliente para uma etapa aleatória.
  if (!etapa || (etapa.tipo !== "PAYMENT_STATUS" && etapa.tipo !== "PAYMENT")) {
    const texto = await textoDaMensagem("pagamento_aprovado", await variaveis(sessao));
    if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);
    return;
  }

  const proximaId = etapa.proximaEtapaId;
  if (!proximaId) {
    const texto = await textoDaMensagem("pagamento_aprovado", await variaveis(sessao));
    if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);
    return;
  }

  const proxima = await prisma.etapaFluxo.findUnique({
    where: { id: proximaId },
    include: { opcoes: true },
  });
  if (!proxima) return;

  const contexto = lerContexto(sessao.conversa);
  delete contexto.esperaAvisada;

  sessao.conversa = await prisma.conversa.update({
    where: { id: conversaId },
    data: {
      fluxoId: proxima.fluxoId,
      etapaId: proxima.id,
      contexto: contexto as never,
    },
  });

  await entrarNaEtapa(sessao, proxima);
}

/**
 * Aplica um desfecho que não é pagamento: falha, expiração, cancelamento ou
 * estorno. Também idempotente — repetir o mesmo evento não reenvia mensagem.
 */
export async function registrarDesfechoPagamento(
  pedidoId: string,
  status: Exclude<StatusPagamento, "PAID" | "PENDING" | "PROCESSING">,
  opcoes: { origem: string; usuarioId?: string | null } = { origem: "webhook" },
): Promise<ResultadoConfirmacao> {
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) return { aplicado: false, motivo: "Pedido não encontrado." };
  if (pedido.status === status) return { aplicado: false, motivo: "Status já aplicado." };

  // Pedido pago só muda para estorno. Um "expired" atrasado não pode apagar um
  // pagamento que já entrou.
  if (pedido.status === "PAID" && status !== "REFUNDED") {
    return { aplicado: false, motivo: "Pedido já pago: desfecho ignorado." };
  }

  await prisma.pedido.update({ where: { id: pedidoId }, data: { status } });
  await prisma.pagamento.updateMany({ where: { pedidoId }, data: { status } });

  await registrarHistorico(
    pedidoId,
    pedido.status,
    status,
    `Status alterado para ${status} (${opcoes.origem})`,
    opcoes.usuarioId,
  );

  await registrarLog({
    tipo: "PAGAMENTO",
    conversaId: pedido.conversaId,
    clienteId: pedido.clienteId,
    descricao: `Pedido #${pedido.numero}: ${status} (${opcoes.origem})`,
  });

  await avisarCliente(pedido.conversaId, status);

  return { aplicado: true };
}

const MENSAGEM_POR_STATUS: Partial<Record<StatusPagamento, string>> = {
  FAILED: "pagamento_recusado",
  EXPIRED: "pagamento_expirado",
  CANCELLED: "pagamento_expirado",
};

async function avisarCliente(conversaId: string | null, status: StatusPagamento): Promise<void> {
  const chave = MENSAGEM_POR_STATUS[status];
  if (!conversaId || !chave) return;

  const sessao = await abrirSessao(conversaId);
  if (!sessao || sessao.conversa.status === "HUMAN" || sessao.conversa.status === "CLOSED") return;

  const texto = await textoDaMensagem(chave, await variaveis(sessao));
  if (texto) await sessao.servico.sendText(contextoEnvio(sessao), texto);

  // O cliente volta a poder escolher: a conversa sai da espera de pagamento.
  await prisma.conversa.update({ where: { id: conversaId }, data: { status: "BOT" } });
}

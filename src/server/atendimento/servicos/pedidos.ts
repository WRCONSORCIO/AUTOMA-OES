import type { Conversa, Pedido, Plano, StatusPagamento } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { obterProvedorPagamento } from "../pagamentos/fabrica";
import { paraCentavos } from "../pagamentos/tipos";
import { registrarLog } from "./logs";

/**
 * Pedidos e cobranças.
 *
 * Duas regras mandam aqui:
 *
 * 1. **O pedido congela o preço.** Alterar o plano depois não muda o que o
 *    cliente já se comprometeu a pagar.
 * 2. **Ninguém marca pago fora do gateway.** Este módulo cria e consulta;
 *    quem muda para `PAID` é o webhook validado, em `confirmarPagamento`.
 */

export interface CobrancaDoCliente {
  pedido: Pedido;
  link: string | null;
  /** `false` quando não há gateway configurado. */
  gatewayConfigurado: boolean;
  erro?: string;
}

/**
 * Reaproveita o pedido pendente do cliente ou cria um novo.
 *
 * Reaproveitar é o que impede a cobrança dupla quando o cliente clica duas
 * vezes no mesmo botão: o segundo clique recebe o link do primeiro pedido, não
 * uma segunda cobrança.
 */
export async function criarOuReaproveitarPedido(
  conversa: Conversa,
  plano: Plano,
  tipo: "NOVA_CONTRATACAO" | "RENOVACAO",
): Promise<CobrancaDoCliente> {
  const agora = new Date();

  const pendente = await prisma.pedido.findFirst({
    where: {
      clienteId: conversa.clienteId,
      planoId: plano.id,
      status: { in: ["PENDING", "PROCESSING"] },
      OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }],
    },
    orderBy: { criadoEm: "desc" },
    include: { pagamentos: { orderBy: { criadoEm: "desc" }, take: 1 } },
  });

  if (pendente) {
    const cobranca = pendente.pagamentos[0];
    if (cobranca?.link) {
      return { pedido: pendente, link: cobranca.link, gatewayConfigurado: true };
    }
  }

  const minutos = env().PAGAMENTO_EXPIRA_MINUTOS;
  const expiraEm = new Date(agora.getTime() + minutos * 60 * 1000);

  const pedido =
    pendente ??
    (await prisma.pedido.create({
      data: {
        clienteId: conversa.clienteId,
        planoId: plano.id,
        conversaId: conversa.id,
        tipo,
        valor: plano.preco,
        moeda: plano.moeda,
        expiraEm,
      },
    }));

  if (!pendente) {
    await registrarHistorico(pedido.id, null, "PENDING", `Pedido #${pedido.numero} criado`);
    await registrarLog({
      tipo: "PEDIDO_CRIADO",
      conversaId: conversa.id,
      clienteId: conversa.clienteId,
      descricao: `Pedido #${pedido.numero} criado para o plano ${plano.nome}`,
      dados: { pedidoId: pedido.id, planoId: plano.id },
    });
  }

  return gerarCobranca(pedido, plano, conversa);
}

/** Cria a cobrança no gateway para um pedido já existente. */
export async function gerarCobranca(
  pedido: Pedido,
  plano: Plano,
  conversa?: Conversa | null,
): Promise<CobrancaDoCliente> {
  const provedor = await obterProvedorPagamento();

  if (!provedor.configurado) {
    return {
      pedido,
      link: null,
      gatewayConfigurado: false,
      erro: "Nenhum gateway de pagamento configurado.",
    };
  }

  const cliente = await prisma.clienteAtendimento.findUnique({ where: { id: pedido.clienteId } });

  try {
    const cobranca = await provedor.createPayment({
      pedidoId: pedido.id,
      numeroPedido: pedido.numero,
      descricao: `${plano.nome} — ${plano.duracaoDias} dias`,
      valorCentavos: paraCentavos(pedido.valor),
      moeda: pedido.moeda,
      clienteNome: cliente?.nome ?? null,
      clienteTelefone: cliente?.telefone ?? "",
      expiraEm: pedido.expiraEm ?? undefined,
    });

    await prisma.pagamento.upsert({
      where: { provedor_externoId: { provedor: provedor.nome, externoId: cobranca.externoId } },
      create: {
        pedidoId: pedido.id,
        provedor: provedor.nome,
        externoId: cobranca.externoId,
        status: cobranca.status,
        valor: pedido.valor,
        moeda: pedido.moeda,
        link: cobranca.link,
        expiraEm: cobranca.expiraEm,
        payload: (cobranca.payload ?? null) as never,
      },
      update: {
        status: cobranca.status,
        link: cobranca.link,
        expiraEm: cobranca.expiraEm,
        payload: (cobranca.payload ?? null) as never,
      },
    });

    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { provedorPagamento: provedor.nome },
    });

    return { pedido, link: cobranca.link, gatewayConfigurado: true };
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : "falha desconhecida";

    await registrarLog({
      tipo: "ERRO",
      conversaId: conversa?.id ?? pedido.conversaId,
      clienteId: pedido.clienteId,
      descricao: `Falha ao gerar cobrança do pedido #${pedido.numero}: ${detalhe}`,
    });

    return { pedido, link: null, gatewayConfigurado: true, erro: detalhe };
  }
}

export async function registrarHistorico(
  pedidoId: string,
  anterior: StatusPagamento | null,
  status: StatusPagamento,
  descricao: string,
  usuarioId?: string | null,
): Promise<void> {
  await prisma.pedidoHistorico.create({
    data: { pedidoId, statusAnterior: anterior, status, descricao, usuarioId: usuarioId ?? null },
  });
}

/** Rótulos exibidos no painel. */
export const ROTULO_STATUS_PAGAMENTO: Record<StatusPagamento, string> = {
  PENDING: "🟡 Aguardando pagamento",
  PROCESSING: "🔵 Processando",
  PAID: "🟢 Pago",
  FAILED: "🔴 Falhou",
  CANCELLED: "⚫ Cancelado",
  EXPIRED: "⏱️ Expirado",
  REFUNDED: "↩️ Estornado",
};

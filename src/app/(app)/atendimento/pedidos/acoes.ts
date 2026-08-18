"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";
import { obterProvedorPagamento } from "@/server/atendimento/pagamentos/fabrica";
import { gerarCobranca } from "@/server/atendimento/servicos/pedidos";
import {
  confirmarPagamento,
  registrarDesfechoPagamento,
} from "@/server/atendimento/motor/pagamento";
import { abrirSessao, contextoEnvio } from "@/server/atendimento/motor/executor";
import { textoDaMensagem } from "@/server/atendimento/servicos/mensagens";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

function revalidar(pedidoId: string): void {
  revalidatePath("/atendimento/pedidos");
  revalidatePath(`/atendimento/pedidos/${pedidoId}`);
}

/**
 * Gera uma nova cobrança para um pedido que expirou ou falhou.
 *
 * O pedido volta a PENDING e o cliente recebe o novo link. Não cria pedido
 * novo: o histórico da tentativa anterior fica preservado no mesmo número.
 */
export async function acaoGerarNovaCobranca(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("pedidos", "editar");
  const id = String(formData.get("id") ?? "");

  const pedido = await prisma.pedido.findUnique({ where: { id }, include: { plano: true } });
  if (!pedido) return { erro: "Pedido não encontrado." };
  if (pedido.status === "PAID") return { erro: "Este pedido já está pago." };

  await prisma.pedido.update({
    where: { id },
    data: { status: "PENDING", expiraEm: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const atualizado = await prisma.pedido.findUniqueOrThrow({ where: { id } });
  const cobranca = await gerarCobranca(atualizado, pedido.plano);

  if (!cobranca.link) {
    return { erro: cobranca.erro ?? "Não foi possível gerar a cobrança." };
  }

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Pedido",
    entidadeId: id,
    descricao: `Nova cobrança gerada para o pedido #${pedido.numero}`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  // O cliente precisa receber o link novo, senão a cobrança fica só no painel.
  if (pedido.conversaId) {
    const conversa = await abrirSessao(pedido.conversaId);
    if (conversa && conversa.conversa.status !== "CLOSED") {
      const texto = await textoDaMensagem("pagamento", {
        plan_name: pedido.plano.nome,
        plan_price: pedido.valor.toString(),
        payment_link: cobranca.link,
        order_id: pedido.numero,
      });
      await conversa.servico.sendText(contextoEnvio(conversa), texto);
    }
  }

  revalidar(id);
  return { sucesso: "Nova cobrança gerada e enviada ao cliente." };
}

export async function acaoCancelarPedido(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("pedidos", "editar");
  const id = String(formData.get("id") ?? "");

  const pedido = await prisma.pedido.findUnique({ where: { id } });
  if (!pedido) return { erro: "Pedido não encontrado." };
  if (pedido.status === "PAID") {
    return { erro: "Pedido pago não é cancelado: use o estorno no gateway." };
  }

  const resultado = await registrarDesfechoPagamento(id, "CANCELLED", {
    origem: `painel (${sessao.nome})`,
    usuarioId: sessao.id,
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Pedido",
    entidadeId: id,
    descricao: `Pedido #${pedido.numero} cancelado pelo painel`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar(id);
  return resultado.aplicado
    ? { sucesso: "Pedido cancelado." }
    : { erro: resultado.motivo ?? "Nada a cancelar." };
}

/**
 * Confirmação manual, exclusiva do gateway simulado.
 *
 * Existe para percorrer o fluxo em desenvolvimento sem credencial de gateway.
 * Com um gateway real ativo a ação é recusada — marcar pagamento à mão em
 * produção é exatamente o que o sistema não pode permitir.
 */
export async function acaoConfirmarPagamentoSimulado(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("pedidos", "editar");
  const id = String(formData.get("id") ?? "");

  const provedor = await obterProvedorPagamento();
  if (!provedor.simulado) {
    return {
      erro: "Confirmação manual só existe no modo simulação. Com gateway real, quem confirma é o webhook.",
    };
  }

  const pedido = await prisma.pedido.findUnique({ where: { id } });
  if (!pedido) return { erro: "Pedido não encontrado." };

  const resultado = await confirmarPagamento(id, new Date(), {
    origem: "painel",
    usuarioId: sessao.id,
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Pedido",
    entidadeId: id,
    descricao: `Pedido #${pedido.numero} confirmado no modo simulação`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar(id);
  return resultado.aplicado
    ? { sucesso: "Pagamento simulado confirmado. O fluxo do cliente continuou." }
    : { erro: resultado.motivo ?? "Nada a confirmar." };
}

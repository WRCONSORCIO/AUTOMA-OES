import { prisma } from "@/lib/prisma";
import { registrarDesfechoPagamento } from "../motor/pagamento";
import { registrarLog } from "./logs";

/**
 * Rotina de manutenção do atendimento.
 *
 * Existe porque nem todo desfecho chega por webhook: uma cobrança que ninguém
 * pagou simplesmente para de ter novidade. Sem esta rotina, o pedido ficaria
 * "aguardando pagamento" para sempre e a conversa presa na etapa de espera.
 *
 * É idempotente: rodar duas vezes seguidas não expira nada duas vezes nem
 * reenvia mensagem, porque `registrarDesfechoPagamento` recusa aplicar um
 * status que já está aplicado.
 */

export interface ResumoManutencao {
  expirados: number;
  conversasEncerradas: number;
}

/** Conversa parada há mais de um dia não deve continuar ocupando o inbox. */
const HORAS_PARA_ENCERRAR_CONVERSA = 24;

export async function executarManutencao(agora: Date = new Date()): Promise<ResumoManutencao> {
  const expirados = await expirarCobrancas(agora);
  const conversasEncerradas = await encerrarConversasParadas(agora);

  if (expirados > 0 || conversasEncerradas > 0) {
    await registrarLog({
      tipo: "PAGAMENTO",
      descricao: `Manutenção: ${expirados} cobrança(s) expirada(s), ${conversasEncerradas} conversa(s) encerrada(s)`,
    });
  }

  return { expirados, conversasEncerradas };
}

async function expirarCobrancas(agora: Date): Promise<number> {
  const vencidos = await prisma.pedido.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      expiraEm: { not: null, lt: agora },
    },
    select: { id: true },
  });

  let expirados = 0;

  for (const pedido of vencidos) {
    // Um a um, e não em massa: cada expiração avisa o cliente e move a conversa.
    const resultado = await registrarDesfechoPagamento(pedido.id, "EXPIRED", {
      origem: "manutenção",
    });
    if (resultado.aplicado) expirados += 1;
  }

  return expirados;
}

async function encerrarConversasParadas(agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - HORAS_PARA_ENCERRAR_CONVERSA * 60 * 60 * 1000);

  // Conversa em atendimento humano nunca é encerrada automaticamente: ela está
  // parada porque alguém ainda não respondeu, e fechá-la esconderia o problema.
  const resultado = await prisma.conversa.updateMany({
    where: {
      status: { in: ["BOT", "WAITING_PAYMENT"] },
      ultimaMensagemEm: { lt: limite },
    },
    data: { status: "CLOSED", encerradaEm: agora },
  });

  return resultado.count;
}

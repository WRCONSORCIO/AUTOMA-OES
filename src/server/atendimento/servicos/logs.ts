import type { Prisma, TipoLogAtendimento } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Registro operacional do atendimento.
 *
 * Separado do `AuditLog` do ERP de propósito: auditoria responde "quem mudou o
 * quê no painel", e este log responde "o que aconteceu com a conversa do
 * cliente". Misturar os dois deixaria a auditoria ilegível — um único
 * atendimento gera dezenas de linhas aqui.
 *
 * Falha de log nunca derruba o atendimento: o cliente não pode ficar sem
 * resposta porque a linha de log não gravou.
 */
export interface EntradaLog {
  tipo: TipoLogAtendimento;
  descricao: string;
  conversaId?: string | null;
  clienteId?: string | null;
  dados?: Prisma.InputJsonValue;
}

export async function registrarLog(entrada: EntradaLog): Promise<void> {
  try {
    await prisma.logAtendimento.create({
      data: {
        tipo: entrada.tipo,
        descricao: entrada.descricao.slice(0, 500),
        conversaId: entrada.conversaId ?? null,
        clienteId: entrada.clienteId ?? null,
        dados: entrada.dados,
      },
    });
  } catch (erro) {
    console.error("[atendimento] falha ao registrar log", erro);
  }
}

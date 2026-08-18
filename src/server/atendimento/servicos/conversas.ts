import type { Conversa, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { empilharEtapa } from "../dominio/motor";

/**
 * Estado da conversa — a memória do fluxo.
 *
 * Tudo aqui vive no PostgreSQL, nunca só em memória: reiniciar o processo não
 * pode fazer o cliente perder onde parou. É por isso que cada avanço de etapa
 * é uma escrita, e não um objeto guardado no processo.
 */

/** Conversa aberta do cliente, ou uma nova. Nunca duas abertas ao mesmo tempo. */
export async function conversaAtiva(
  clienteId: string,
  instanciaId?: string | null,
): Promise<Conversa> {
  const aberta = await prisma.conversa.findFirst({
    where: { clienteId, status: { not: "CLOSED" } },
    orderBy: { iniciadaEm: "desc" },
  });

  if (aberta) return aberta;

  return prisma.conversa.create({
    data: { clienteId, instanciaId: instanciaId ?? null, status: "BOT" },
  });
}

export function lerContexto(conversa: Conversa): Record<string, unknown> {
  const bruto = conversa.contexto;
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    return { ...(bruto as Record<string, unknown>) };
  }
  return {};
}

export function lerHistorico(conversa: Conversa): string[] {
  const bruto = conversa.historicoEtapas;
  if (Array.isArray(bruto)) return bruto.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * Move a conversa para uma etapa, empilhando de onde veio.
 *
 * O histórico é o que faz o "🔙 Voltar" voltar de verdade, em vez de só mandar
 * uma mensagem dizendo que voltou.
 */
export async function moverParaEtapa(
  conversa: Conversa,
  destino: { fluxoId: string; etapaId: string },
  extras: { contexto?: Record<string, unknown>; empilharAtual?: boolean } = {},
): Promise<Conversa> {
  const historico =
    extras.empilharAtual !== false && conversa.etapaId
      ? empilharEtapa(lerHistorico(conversa), conversa.etapaId)
      : lerHistorico(conversa);

  return prisma.conversa.update({
    where: { id: conversa.id },
    data: {
      fluxoId: destino.fluxoId,
      etapaId: destino.etapaId,
      historicoEtapas: historico as Prisma.InputJsonValue,
      contexto: (extras.contexto ?? lerContexto(conversa)) as Prisma.InputJsonValue,
      ultimaMensagemEm: new Date(),
    },
  });
}

export async function gravarContexto(
  conversa: Conversa,
  contexto: Record<string, unknown>,
): Promise<Conversa> {
  return prisma.conversa.update({
    where: { id: conversa.id },
    data: { contexto: contexto as Prisma.InputJsonValue },
  });
}

export async function gravarHistorico(
  conversa: Conversa,
  historico: string[],
): Promise<Conversa> {
  return prisma.conversa.update({
    where: { id: conversa.id },
    data: { historicoEtapas: historico as Prisma.InputJsonValue },
  });
}

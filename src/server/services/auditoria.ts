import "server-only";

import { headers } from "next/headers";
import type { AcaoAuditoria, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessaoUsuario } from "@/server/auth/session";

export interface EntradaAuditoria {
  acao: AcaoAuditoria;
  entidade: string;
  entidadeId?: string | null;
  descricao: string;
  dadosAntes?: unknown;
  dadosDepois?: unknown;
  usuario?: Pick<SessaoUsuario, "id" | "nome"> | null;
}

/**
 * Registra a auditoria. Toda alteração relevante do sistema passa por aqui.
 * Falhas de auditoria nunca derrubam a operação de negócio, mas são logadas.
 */
export async function registrarAuditoria(
  entrada: EntradaAuditoria,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  try {
    const { ip, userAgent } = await capturarOrigem();

    await tx.auditLog.create({
      data: {
        usuarioId: entrada.usuario?.id ?? null,
        usuarioNome: entrada.usuario?.nome ?? null,
        acao: entrada.acao,
        entidade: entrada.entidade,
        entidadeId: entrada.entidadeId ?? null,
        descricao: entrada.descricao,
        dadosAntes: serializar(entrada.dadosAntes),
        dadosDepois: serializar(entrada.dadosDepois),
        ip,
        userAgent,
      },
    });
  } catch (erro) {
    console.error("[auditoria] falha ao registrar log", erro);
  }
}

async function capturarOrigem(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const cabecalhos = await headers();
    const encaminhado = cabecalhos.get("x-forwarded-for");
    return {
      ip: encaminhado?.split(",")[0]?.trim() ?? cabecalhos.get("x-real-ip") ?? null,
      userAgent: cabecalhos.get("user-agent"),
    };
  } catch {
    // Contextos fora de requisição (cron, scripts) não possuem headers.
    return { ip: null, userAgent: null };
  }
}

/** Decimal e Date do Prisma não são serializáveis diretamente em JSON. */
function serializar(valor: unknown): Prisma.InputJsonValue | undefined {
  if (valor === undefined || valor === null) return undefined;
  return JSON.parse(
    JSON.stringify(valor, (_chave, item) => {
      if (item instanceof Date) return item.toISOString();
      if (typeof item === "bigint") return item.toString();
      if (item && typeof item === "object" && "toFixed" in item && typeof item.toFixed === "function") {
        return item.toString();
      }
      return item;
    }),
  ) as Prisma.InputJsonValue;
}

/**
 * Calcula o diff entre dois estados de um registro para gravar apenas os
 * campos que realmente mudaram.
 */
export function calcularDiff<T extends Record<string, unknown>>(
  antes: T,
  depois: Partial<T>,
): { antes: Partial<T>; depois: Partial<T>; houveMudanca: boolean } {
  const diffAntes: Partial<T> = {};
  const diffDepois: Partial<T> = {};

  for (const chave of Object.keys(depois) as (keyof T)[]) {
    const valorAntes = antes[chave];
    const valorDepois = depois[chave];
    if (!saoIguais(valorAntes, valorDepois)) {
      diffAntes[chave] = valorAntes;
      diffDepois[chave] = valorDepois;
    }
  }

  return {
    antes: diffAntes,
    depois: diffDepois,
    houveMudanca: Object.keys(diffDepois).length > 0,
  };
}

function saoIguais(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return String(a) === String(b);
  }
  return false;
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { drenarEventos } from "@/shared/events/handlers";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Recolhe eventos que ficaram para trás.
 *
 * A importação já drena a fila antes de mostrar o resumo, então em operação
 * normal não sobra nada aqui. Esta rota existe para o que sobra quando algo dá
 * errado: um handler que falhou e voltou para a fila com backoff, ou um evento
 * publicado por uma ação que não é importação (promoção, troca de vendedor).
 *
 * Sem ela, um evento que falhasse ficaria parado até a próxima importação — o
 * que pode ser semanas, e no meio delas um estorno não calculado.
 *
 * Protegida pelo mesmo token do backup: é infraestrutura, não tela.
 */
export async function POST(requisicao: Request) {
  const tokenConfigurado = env().BACKUP_CRON_TOKEN;

  if (!tokenConfigurado) {
    return NextResponse.json(
      { erro: "BACKUP_CRON_TOKEN não configurado no servidor." },
      { status: 503 },
    );
  }

  const informado = requisicao.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!compararSeguro(informado, tokenConfigurado)) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }

  try {
    const resumo = await drenarEventos();

    // Eventos que esgotaram o retry não voltam sozinhos. Reportar a contagem
    // aqui é o que transforma "sumiu" em "apareceu no monitoramento".
    const emFalhaDefinitiva = await prisma.eventoDominio.count({
      where: { status: "FALHA" },
    });

    return NextResponse.json({ ok: true, ...resumo, emFalhaDefinitiva });
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : "Falha ao processar a fila de eventos." },
      { status: 500 },
    );
  }
}

function compararSeguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

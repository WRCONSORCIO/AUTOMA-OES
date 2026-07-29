import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { gerarBackup } from "@/server/services/backup";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Endpoint do backup diário. Protegido por token compartilhado com o
 * agendador (cron do servidor, Kubernetes CronJob ou similar).
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
    const resultado = await gerarBackup("AUTOMATICO");
    return NextResponse.json({ ok: true, ...resultado });
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : "Falha ao gerar o backup." },
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

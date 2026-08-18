import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { lerSessao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { executarManutencao } from "@/server/atendimento/servicos/manutencao";

/**
 * Rotina periódica do atendimento: expira cobranças vencidas e encerra
 * conversas abandonadas.
 *
 * Chamada por um agendador externo (cron do sistema, cron da hospedagem) com o
 * mesmo token dos backups, ou manualmente por um administrador logado. Sem
 * token configurado, só a sessão autenticada libera — nunca fica aberta.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await autorizado(request))) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const resumo = await executarManutencao();
  return NextResponse.json({ ok: true, ...resumo });
}

async function autorizado(request: Request): Promise<boolean> {
  const token = env().BACKUP_CRON_TOKEN;
  const enviado = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (token && enviado === token) return true;

  const sessao = await lerSessao();
  return Boolean(sessao && podeAcessar(sessao.perfil, "configAtendimento", "editar"));
}

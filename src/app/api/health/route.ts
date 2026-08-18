import { NextResponse } from "next/server";
import { lerSessao } from "@/server/auth/session";
import { resumoPublico, verificarSaude } from "@/server/atendimento/servicos/saude";

/**
 * Sonda de saúde, usada por monitoramento externo e pela tela do painel.
 *
 * Sem sessão, a resposta diz apenas se cada serviço está de pé. O detalhe —
 * mensagem de erro do gateway, id da conta, motivo da falha — só sai para quem
 * está autenticado: monitoramento não precisa dele, e um erro de provedor pode
 * revelar configuração interna.
 */
export async function GET(): Promise<Response> {
  const saude = await verificarSaude();
  const sessao = await lerSessao();

  const corpo = sessao ? saude : resumoPublico(saude);

  return NextResponse.json(corpo, {
    status: saude.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { decifrar } from "@/server/atendimento/servicos/segredos";
import { registrarLog } from "@/server/atendimento/servicos/logs";
import { lerWebhookEvolution } from "@/server/atendimento/whatsapp/evolution";
import { processarMensagemRecebida } from "@/server/atendimento/motor/executor";

/**
 * Entrada das mensagens do WhatsApp.
 *
 * Devolve 200 em quase todo caso, de propósito: provedor que recebe erro
 * reentrega o mesmo evento em laço. Erro de processamento vira log, não vira
 * reentrega infinita. A proteção contra duplicidade é o `externoId` único da
 * mensagem, verificado no executor.
 */

export async function POST(request: Request): Promise<Response> {
  const instanciaId = new URL(request.url).searchParams.get("instancia");

  if (!(await tokenValido(request, instanciaId))) {
    return NextResponse.json({ erro: "Token inválido" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Corpo inválido" }, { status: 400 });
  }

  const mensagem = lerWebhookEvolution(corpo);

  // Evento que não é mensagem (status de conexão, recibo de leitura) não é
  // erro: só não há o que fazer com ele.
  if (!mensagem) return NextResponse.json({ ok: true, ignorado: true });

  try {
    await processarMensagemRecebida(mensagem, instanciaId);
  } catch (erro) {
    console.error("[webhook whatsapp] falha", erro);
    await registrarLog({
      tipo: "ERRO",
      descricao: `Falha ao processar webhook do WhatsApp: ${
        erro instanceof Error ? erro.message : "desconhecida"
      }`,
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * O token pode vir por `Authorization: Bearer`, por `apikey` ou pela query —
 * provedores diferem. Sem token configurado, o endpoint aceita: é o modo de
 * desenvolvimento, e a tela de configuração avisa que ele está aberto.
 */
async function tokenValido(request: Request, instanciaId: string | null): Promise<boolean> {
  const esperado = await tokenEsperado(instanciaId);
  if (!esperado) return true;

  const cabecalho = request.headers.get("authorization");
  const recebido =
    cabecalho?.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("apikey") ||
    request.headers.get("x-webhook-token") ||
    new URL(request.url).searchParams.get("token");

  return recebido === esperado;
}

async function tokenEsperado(instanciaId: string | null): Promise<string | null> {
  const instancia = instanciaId
    ? await prisma.instanciaWhatsApp.findUnique({ where: { id: instanciaId } })
    : await prisma.instanciaWhatsApp.findFirst({
        where: { status: "ATIVO" },
        orderBy: [{ padrao: "desc" }, { criadoEm: "asc" }],
      });

  const doBanco = decifrar(instancia?.webhookTokenCifrado);
  return doBanco ?? env().WHATSAPP_WEBHOOK_TOKEN ?? null;
}

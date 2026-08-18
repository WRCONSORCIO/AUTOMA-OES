import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { obterProvedorPagamento } from "@/server/atendimento/pagamentos/fabrica";
import type { EventoWebhookPagamento } from "@/server/atendimento/pagamentos/tipos";
import { registrarLog } from "@/server/atendimento/servicos/logs";
import {
  confirmarPagamento,
  registrarDesfechoPagamento,
} from "@/server/atendimento/motor/pagamento";

/**
 * Webhook do gateway de pagamento.
 *
 * É o único caminho pelo qual um pedido vira PAGO. A ordem é sempre a mesma:
 *
 * 1. valida a assinatura — payload sem assinatura válida é descartado;
 * 2. grava o evento com id único — a segunda entrega do mesmo evento não
 *    executa nada (idempotência por restrição de banco, não por `if`);
 * 3. localiza o pedido;
 * 4. aplica o desfecho e continua o fluxo do WhatsApp.
 *
 * Responde 200 para evento repetido ou desconhecido: o gateway não deve
 * reentregar o que já foi tratado.
 */

export async function POST(request: Request): Promise<Response> {
  const corpo = await request.text();
  const assinatura = request.headers.get("stripe-signature");

  const provedor = await obterProvedorPagamento();
  if (!provedor.configurado) {
    return NextResponse.json({ erro: "Gateway não configurado" }, { status: 503 });
  }

  const evento = await provedor.validateWebhook(corpo, assinatura);

  if (!evento) {
    await registrarLog({
      tipo: "WEBHOOK",
      descricao: "Webhook de pagamento rejeitado: assinatura inválida ou corpo ilegível.",
    });
    return NextResponse.json({ erro: "Assinatura inválida" }, { status: 400 });
  }

  // A gravação é a trava: `@@unique([provedor, eventoId])` faz a segunda
  // entrega falhar aqui, antes de qualquer efeito colateral.
  try {
    await prisma.eventoPagamento.create({
      data: {
        provedor: provedor.nome,
        eventoId: evento.eventoId,
        tipo: evento.tipo,
        payload: evento.resumo as Prisma.InputJsonValue,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return NextResponse.json({ ok: true, repetido: true });
    }
    throw erro;
  }

  try {
    const resultado = await aplicarEvento(provedor.nome, evento);

    await prisma.eventoPagamento.update({
      where: { provedor_eventoId: { provedor: provedor.nome, eventoId: evento.eventoId } },
      data: {
        status: resultado.aplicado ? "PROCESSADO" : "IGNORADO",
        pedidoId: resultado.pedidoId ?? null,
        processadoEm: new Date(),
      },
    });

    await registrarLog({
      tipo: "WEBHOOK",
      descricao: `Evento ${evento.tipo} (${evento.eventoId}): ${
        resultado.aplicado ? "processado" : (resultado.motivo ?? "ignorado")
      }`,
    });

    return NextResponse.json({ ok: true });
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : "falha desconhecida";

    await prisma.eventoPagamento.update({
      where: { provedor_eventoId: { provedor: provedor.nome, eventoId: evento.eventoId } },
      data: { status: "ERRO", erro: detalhe, processadoEm: new Date() },
    });

    await registrarLog({
      tipo: "ERRO",
      descricao: `Falha ao processar webhook ${evento.eventoId}: ${detalhe}`,
    });

    // 500 faz o gateway reentregar. O evento fica gravado como ERRO, e a
    // reentrega cai no caminho de repetido — por isso a reprocessagem manual
    // acontece pelo painel, não pela reentrega.
    return NextResponse.json({ erro: "Falha ao processar" }, { status: 500 });
  }
}

interface ResultadoEvento {
  aplicado: boolean;
  pedidoId?: string | null;
  motivo?: string;
}

async function aplicarEvento(
  provedor: "STRIPE" | "MERCADO_PAGO" | "ASAAS" | "PAGBANK" | "MANUAL",
  evento: EventoWebhookPagamento,
): Promise<ResultadoEvento> {
  if (!evento.status) return { aplicado: false, motivo: "evento sem efeito sobre o pedido" };
  if (!evento.externoId) return { aplicado: false, motivo: "evento sem cobrança identificável" };

  const pagamento = await localizarPagamento(provedor, evento.externoId);
  if (!pagamento) return { aplicado: false, motivo: "cobrança não encontrada" };

  if (evento.status === "PAID") {
    const resultado = await confirmarPagamento(pagamento.pedidoId, evento.pagoEm ?? new Date(), {
      origem: "webhook",
    });
    return { ...resultado, pedidoId: pagamento.pedidoId };
  }

  if (evento.status === "PROCESSING") {
    await prisma.pagamento.update({
      where: { id: pagamento.id },
      data: { status: "PROCESSING" },
    });
    await prisma.pedido.updateMany({
      where: { id: pagamento.pedidoId, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    return { aplicado: true, pedidoId: pagamento.pedidoId };
  }

  if (evento.status === "PENDING") {
    // Volta para pendente não é desfecho: não há nada a comunicar ao cliente.
    return { aplicado: false, pedidoId: pagamento.pedidoId, motivo: "cobrança segue pendente" };
  }

  const resultado = await registrarDesfechoPagamento(pagamento.pedidoId, evento.status, {
    origem: "webhook",
  });
  return { ...resultado, pedidoId: pagamento.pedidoId };
}

/**
 * Encontra a cobrança pelo id do gateway.
 *
 * O estorno chega referenciando a intenção de pagamento, não a sessão de
 * checkout — por isso a segunda tentativa procura dentro do payload guardado
 * quando a cobrança foi criada ou confirmada.
 */
async function localizarPagamento(
  provedor: "STRIPE" | "MERCADO_PAGO" | "ASAAS" | "PAGBANK" | "MANUAL",
  externoId: string,
) {
  const direto = await prisma.pagamento.findUnique({
    where: { provedor_externoId: { provedor, externoId } },
  });
  if (direto) return direto;

  return prisma.pagamento.findFirst({
    where: { provedor, payload: { path: ["payment_intent"], equals: externoId } },
    orderBy: { criadoEm: "desc" },
  });
}

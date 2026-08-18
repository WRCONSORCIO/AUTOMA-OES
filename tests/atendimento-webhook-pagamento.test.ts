import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { criarEstruturaAtendimento } from "@/server/atendimento/instalacao";
import { bancoDisponivel, limparAtendimento } from "./apoio/banco";

/**
 * Webhook de pagamento: assinatura, idempotência e efeito no pedido.
 *
 * Bate no handler da rota de verdade, com corpo assinado como a Stripe assina.
 * Nenhuma chamada sai para a rede: a validação do webhook é local.
 */

const SEGREDO = "whsec_teste_webhook";
const TELEFONE = "5511988880001";

const temBanco = await bancoDisponivel();

describe.skipIf(!temBanco)("webhook de pagamento", () => {
  let POST: (request: Request) => Promise<Response>;
  let pedidoId: string;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_qualquer";
    process.env.STRIPE_WEBHOOK_SECRET = SEGREDO;
    delete process.env.PAYMENT_PROVIDER;

    await limparAtendimento();
    await criarEstruturaAtendimento();

    ({ POST } = await import("@/app/api/webhooks/stripe/route"));

    const plano = await prisma.plano.create({
      data: { nome: "Plano 90 dias", duracaoDias: 90, preco: "249.90" },
    });

    const cliente = await prisma.clienteAtendimento.create({
      data: { telefone: TELEFONE, telefoneExibicao: "+55 (11) 98888-0001", nome: "Cliente" },
    });

    const conversa = await prisma.conversa.create({
      data: { clienteId: cliente.id, status: "WAITING_PAYMENT" },
    });

    const pedido = await prisma.pedido.create({
      data: {
        clienteId: cliente.id,
        planoId: plano.id,
        conversaId: conversa.id,
        valor: plano.preco,
        moeda: plano.moeda,
      },
    });
    pedidoId = pedido.id;

    await prisma.pagamento.create({
      data: {
        pedidoId: pedido.id,
        provedor: "STRIPE",
        externoId: "cs_teste_1",
        valor: pedido.valor,
        moeda: pedido.moeda,
        link: "https://checkout.stripe.com/c/pay/cs_teste_1",
      },
    });
  });

  afterAll(async () => {
    await limparAtendimento();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("recusa payload sem assinatura válida", async () => {
    const corpo = JSON.stringify(eventoPago("evt_falso"));
    const resposta = await POST(requisicao(corpo, "t=1,v1=abc"));

    expect(resposta.status).toBe(400);

    const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    expect(pedido.status).toBe("PENDING");
  });

  it("confirma o pedido com assinatura válida e não confirma duas vezes", async () => {
    const corpo = JSON.stringify(eventoPago("evt_pago_1"));
    const cabecalho = assinar(corpo);

    const primeira = await POST(requisicao(corpo, cabecalho));
    expect(primeira.status).toBe(200);

    const pago = await prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    expect(pago.status).toBe("PAID");
    expect(pago.pagoEm).not.toBeNull();

    const mensagens = await prisma.mensagemAtendimento.count({ where: { origem: "BOT" } });

    // Reentrega do mesmo evento: nada é reprocessado, nada é reenviado.
    const segunda = await POST(requisicao(corpo, cabecalho));
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ repetido: true });

    expect(await prisma.mensagemAtendimento.count({ where: { origem: "BOT" } })).toBe(mensagens);
    expect(await prisma.eventoPagamento.count({ where: { eventoId: "evt_pago_1" } })).toBe(1);
  });

  it("expiração que chega depois do pagamento não desfaz o pedido pago", async () => {
    const corpo = JSON.stringify({
      id: "evt_expirado",
      type: "checkout.session.expired",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_teste_1" } },
    });

    const resposta = await POST(requisicao(corpo, assinar(corpo)));
    expect(resposta.status).toBe(200);

    const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    expect(pedido.status).toBe("PAID");

    const evento = await prisma.eventoPagamento.findFirstOrThrow({
      where: { eventoId: "evt_expirado" },
    });
    expect(evento.status).toBe("IGNORADO");
  });
});

function eventoPago(id: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cs_teste_1", payment_status: "paid", payment_intent: "pi_teste_1" } },
  };
}

function assinar(corpo: string): string {
  const t = Math.floor(Date.now() / 1000);
  const assinatura = createHmac("sha256", SEGREDO).update(`${t}.${corpo}`, "utf8").digest("hex");
  return `t=${t},v1=${assinatura}`;
}

function requisicao(corpo: string, assinatura: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": assinatura, "content-type": "application/json" },
    body: corpo,
  });
}

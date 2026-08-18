import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaConfere, traduzirEvento } from "@/server/atendimento/pagamentos/stripe";

/**
 * A assinatura do webhook é o que separa "o gateway confirmou" de "alguém
 * mandou um POST". Testada sem rede, porque é HMAC puro.
 */

const SEGREDO = "whsec_teste_do_projeto";

function assinar(corpo: string, quando: Date, segredo = SEGREDO): string {
  const t = Math.floor(quando.getTime() / 1000);
  const assinatura = createHmac("sha256", segredo).update(`${t}.${corpo}`, "utf8").digest("hex");
  return `t=${t},v1=${assinatura}`;
}

describe("assinatura do webhook Stripe", () => {
  const agora = new Date("2026-08-18T12:00:00Z");
  const corpo = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("aceita assinatura válida dentro da tolerância", () => {
    expect(assinaturaConfere(corpo, assinar(corpo, agora), SEGREDO, agora)).toBe(true);
  });

  it("recusa assinatura feita com outro segredo", () => {
    const cabecalho = assinar(corpo, agora, "whsec_outro");
    expect(assinaturaConfere(corpo, cabecalho, SEGREDO, agora)).toBe(false);
  });

  it("recusa corpo alterado depois de assinado", () => {
    const cabecalho = assinar(corpo, agora);
    const adulterado = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", x: 1 });

    expect(assinaturaConfere(adulterado, cabecalho, SEGREDO, agora)).toBe(false);
  });

  it("recusa replay antigo mesmo com assinatura correta", () => {
    const cabecalho = assinar(corpo, new Date(agora.getTime() - 10 * 60 * 1000));
    expect(assinaturaConfere(corpo, cabecalho, SEGREDO, agora)).toBe(false);
  });

  it("aceita quando uma das assinaturas da rotação confere", () => {
    const t = Math.floor(agora.getTime() / 1000);
    const boa = createHmac("sha256", SEGREDO).update(`${t}.${corpo}`, "utf8").digest("hex");
    const cabecalho = `t=${t},v1=deadbeef,v1=${boa}`;

    expect(assinaturaConfere(corpo, cabecalho, SEGREDO, agora)).toBe(true);
  });

  it("recusa cabeçalho sem timestamp ou sem assinatura", () => {
    expect(assinaturaConfere(corpo, "v1=abc", SEGREDO, agora)).toBe(false);
    expect(assinaturaConfere(corpo, "t=123", SEGREDO, agora)).toBe(false);
    expect(assinaturaConfere(corpo, "", SEGREDO, agora)).toBe(false);
  });
});

describe("tradução dos eventos do Stripe", () => {
  it("só marca pago quando o pagamento foi mesmo pago", () => {
    const pago = traduzirEvento({
      id: "evt_pago",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid" } },
    });

    expect(pago.status).toBe("PAID");
    expect(pago.externoId).toBe("cs_1");
  });

  it("sessão completa sem pagamento fica em processamento, não em pago", () => {
    // Pagamento assíncrono completa a sessão antes do dinheiro entrar. Marcar
    // PAID aqui liberaria o serviço sem pagamento.
    const assincrono = traduzirEvento({
      id: "evt_async",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", payment_status: "unpaid" } },
    });

    expect(assincrono.status).toBe("PROCESSING");
  });

  it("traduz expiração, falha e estorno", () => {
    expect(
      traduzirEvento({
        id: "e1",
        type: "checkout.session.expired",
        data: { object: { id: "cs_3" } },
      }).status,
    ).toBe("EXPIRED");

    expect(
      traduzirEvento({
        id: "e2",
        type: "checkout.session.async_payment_failed",
        data: { object: { id: "cs_4" } },
      }).status,
    ).toBe("FAILED");

    const estorno = traduzirEvento({
      id: "e3",
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: "pi_1" } },
    });

    expect(estorno.status).toBe("REFUNDED");
    // No estorno o vínculo com o pedido é a intenção de pagamento.
    expect(estorno.externoId).toBe("pi_1");
  });

  it("evento desconhecido não vira status", () => {
    const evento = traduzirEvento({
      id: "e4",
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });

    expect(evento.status).toBeNull();
  });
});

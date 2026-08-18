import { describe, expect, it } from "vitest";
import {
  aplicarVariaveis,
  variaveisDesconhecidas,
  variaveisUsadas,
} from "@/server/atendimento/dominio/variaveis";

describe("variáveis de mensagem", () => {
  it("substitui as variáveis conhecidas", () => {
    const texto = "Olá, {{customer_name}}! Plano {{plan_name}} por {{plan_price}}.";

    expect(
      aplicarVariaveis(texto, {
        customer_name: "João",
        plan_name: "90 dias",
        plan_price: "R$ 99,90",
      }),
    ).toBe("Olá, João! Plano 90 dias por R$ 99,90.");
  });

  it("aceita espaço dentro das chaves", () => {
    expect(aplicarVariaveis("Pedido {{ order_id }}", { order_id: 1025 })).toBe("Pedido 1025");
  });

  it("apaga a variável sem valor em vez de mostrar o marcador ao cliente", () => {
    expect(aplicarVariaveis("Link: {{payment_link}}", {})).toBe("Link: ");
    expect(aplicarVariaveis("Link: {{payment_link}}", { payment_link: null })).toBe("Link: ");
  });

  it("lista as variáveis usadas e as que o sistema não sabe preencher", () => {
    const texto = "{{customer_name}} · {{inventada}} · {{plan_name}}";

    expect(variaveisUsadas(texto)).toEqual(["customer_name", "inventada", "plan_name"]);
    expect(variaveisDesconhecidas(texto)).toEqual(["inventada"]);
  });
});

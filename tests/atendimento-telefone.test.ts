import { describe, expect, it } from "vitest";
import {
  formatarTelefone,
  jidDoNumero,
  normalizarTelefone,
} from "@/server/atendimento/dominio/telefone";

describe("normalização de telefone", () => {
  it("colapsa os formatos que o provedor envia no mesmo número", () => {
    const formatos = [
      "5511999998888",
      "+55 11 99999-8888",
      "5511999998888@s.whatsapp.net",
      "(11) 99999-8888",
      "11999998888",
    ];

    const numeros = new Set(formatos.map((bruto) => normalizarTelefone(bruto)?.numero));

    expect(numeros).toEqual(new Set(["5511999998888"]));
  });

  it("não altera número internacional escrito com +", () => {
    expect(normalizarTelefone("+1 415 555 0100")?.numero).toBe("14155550100");
  });

  it("assume DDI 55 quando não há + e o número tem cara de brasileiro", () => {
    // Sem o `+`, `14155550100` é lido como DDD 14 — é o caso comum de quem
    // digita o próprio número sem DDI.
    expect(normalizarTelefone("14155550100")?.numero).toBe("5514155550100");
  });

  it("recusa entrada sem número plausível", () => {
    expect(normalizarTelefone("")).toBeNull();
    expect(normalizarTelefone(null)).toBeNull();
    expect(normalizarTelefone("status@broadcast")).toBeNull();
    expect(normalizarTelefone("1234567")).toBeNull();
  });

  it("formata número brasileiro para leitura no painel", () => {
    expect(formatarTelefone("5511999998888")).toBe("+55 (11) 99999-8888");
    expect(formatarTelefone("551133334444")).toBe("+55 (11) 3333-4444");
    expect(formatarTelefone("14155550100")).toBe("+14155550100");
  });

  it("monta o JID de envio", () => {
    expect(jidDoNumero("5511999998888")).toBe("5511999998888@s.whatsapp.net");
  });
});

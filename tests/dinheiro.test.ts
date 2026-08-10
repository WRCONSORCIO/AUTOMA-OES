import { describe, expect, it } from "vitest";
import {
  arredondar,
  percentual,
  percentualEntre,
  ratear,
  ratearIgualmente,
  somar,
} from "@/shared/domain/dinheiro";

describe("arredondamento comercial", () => {
  it("arredonda meio centavo para cima, onde o float erra", () => {
    // Math.round(1.005 * 100) / 100 devolve 1.00 porque 1.005*100 é
    // 100.49999999999999 em ponto flutuante.
    expect(arredondar(1.005)).toBe(1.01);
    expect(arredondar(2.675)).toBe(2.68);
  });

  it("mantém o sinal em valores negativos (estorno)", () => {
    expect(arredondar(-1.005)).toBe(-1.01);
    expect(arredondar(-0.125)).toBe(-0.13);
  });

  it("não propaga NaN nem Infinity para o financeiro", () => {
    expect(arredondar(Number.NaN)).toBe(0);
    expect(arredondar(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("soma sem acumular erro de ponto flutuante", () => {
    expect(somar(0.1, 0.2)).toBe(0.3);
    expect(somar(...Array.from({ length: 10 }, () => 0.1))).toBe(1);
  });
});

describe("percentual", () => {
  it("aplica pontos percentuais", () => {
    expect(percentual(1000, 12.5)).toBe(125);
  });

  it("divisão por zero devolve zero, não Infinity", () => {
    expect(percentualEntre(50, 0)).toBe(0);
  });
});

describe("rateio", () => {
  const soma = (partes: readonly { valor: number }[]) =>
    arredondar(partes.reduce((total, { valor }) => total + valor, 0));

  it("não perde centavo na divisão que não fecha", () => {
    // 100/3 = 33,333... Arredondar cada parte isolada daria 99,99.
    const partes = ratearIgualmente(100, ["a", "b", "c"]);
    expect(soma(partes)).toBe(100);
    expect(partes.map((p) => p.valor).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("dá o centavo sobrando a quem tem o maior resto", () => {
    const partes = ratear(100, [
      { item: "grande", peso: 70 },
      { item: "pequeno", peso: 30 },
    ]);
    expect(soma(partes)).toBe(100);
    expect(partes.find((p) => p.item === "grande")?.valor).toBe(70);
  });

  it("fecha exatamente com pesos irregulares", () => {
    const partes = ratear(1234.56, [
      { item: "a", peso: 17 },
      { item: "b", peso: 41 },
      { item: "c", peso: 3 },
      { item: "d", peso: 89 },
    ]);
    expect(soma(partes)).toBe(1234.56);
  });

  it("rateia estorno (valor negativo) sem perder centavo", () => {
    const partes = ratearIgualmente(-100, ["a", "b", "c"]);
    expect(soma(partes)).toBe(-100);
  });

  it("peso total zero devolve tudo zerado em vez de dividir por zero", () => {
    const partes = ratear(500, [
      { item: "a", peso: 0 },
      { item: "b", peso: 0 },
    ]);
    expect(partes.every((p) => p.valor === 0)).toBe(true);
  });

  it("lista vazia não quebra", () => {
    expect(ratear(100, [])).toEqual([]);
  });

  it("proporcionalidade se mantém em base grande", () => {
    const partes = ratear(1_000_000, [
      { item: "gerencia-a", peso: 1 },
      { item: "gerencia-b", peso: 999 },
    ]);
    expect(soma(partes)).toBe(1_000_000);
    expect(partes.find((p) => p.item === "gerencia-a")?.valor).toBe(1000);
  });
});

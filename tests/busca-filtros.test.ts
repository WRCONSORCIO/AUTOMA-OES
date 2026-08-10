import { describe, expect, it } from "vitest";
import { digitosDaBusca } from "@/lib/filtros";

/**
 * O defeito que originou este arquivo: a busca por documento era montada como
 * `contains: termo.replace(/\D+/g, "")`. Com um nome no campo, a limpeza
 * devolve string vazia, `contains: ""` vira `LIKE '%%'`, e como a condição
 * estava num `OR`, a busca inteira parava de filtrar.
 *
 * Medido na base real: procurar "SILVA" entre 128 vendedores devolvia os 128.
 * Parecia que a busca por nome não funcionava; na verdade ela funcionava e a
 * condição de documento anulava o resultado.
 */
describe("dígitos da busca", () => {
  it("devolve null para termo sem dígito nenhum — é o caso do defeito", () => {
    expect(digitosDaBusca("SILVA")).toBeNull();
    expect(digitosDaBusca("José da Silva")).toBeNull();
  });

  it("devolve null para termo vazio ou ausente", () => {
    expect(digitosDaBusca("")).toBeNull();
    expect(digitosDaBusca(undefined)).toBeNull();
    expect(digitosDaBusca("   ")).toBeNull();
  });

  it("tira a máscara do documento digitado", () => {
    expect(digitosDaBusca("123.456.789-01")).toBe("12345678901");
    expect(digitosDaBusca("59.598.070/0001-36")).toBe("59598070000136");
  });

  it("aceita busca por pedaço do documento", () => {
    expect(digitosDaBusca("5959")).toBe("5959");
  });

  it("aproveita os dígitos de um termo misto em vez de descartá-los", () => {
    // "Silva 123" continua buscando por nome; os dígitos apenas acrescentam
    // uma chance de casar por documento, nunca anulam o filtro.
    expect(digitosDaBusca("Silva 123")).toBe("123");
  });
});

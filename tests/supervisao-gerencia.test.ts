import { describe, expect, it } from "vitest";
import {
  remuneraSupervisaoEGerencia,
  wrPagaComissaoDaVenda,
} from "@/server/domain/tabelas-internas";

/**
 * A WR paga comissão sobre venda de INICIANTE e mais nada. Venda de veterano
 * ou expert é paga direto pela administradora ao vendedor: não sai dinheiro da
 * WR para ninguém — nem para ele, nem para a supervisão, nem para a gerência.
 */
describe("quem a WR paga por uma venda", () => {
  it("venda de iniciante paga vendedor, supervisão e gerência", () => {
    expect(wrPagaComissaoDaVenda("INICIANTE")).toBe(true);
    expect(remuneraSupervisaoEGerencia("INICIANTE")).toBe(true);
  });

  it("veterano e expert não pagam NINGUÉM — nem o próprio vendedor", () => {
    for (const categoria of ["VETERANO", "EXPERT"]) {
      expect(wrPagaComissaoDaVenda(categoria)).toBe(false);
      expect(remuneraSupervisaoEGerencia(categoria)).toBe(false);
    }
  });

  it("venda sem categoria não paga ninguém", () => {
    // Sem saber sob qual condição a venda foi feita, pagar seria pagar por
    // suposição — e o erro sairia na folha de alguém.
    expect(wrPagaComissaoDaVenda(null)).toBe(false);
    expect(wrPagaComissaoDaVenda(undefined)).toBe(false);
  });
});

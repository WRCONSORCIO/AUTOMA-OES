import { describe, expect, it } from "vitest";
import { remuneraSupervisaoEGerencia } from "@/server/domain/tabelas-internas";

/**
 * Supervisão e gerência saem do mesmo bolso que a comissão do iniciante — o da
 * WR. Venda de veterano ou expert é paga direto pela administradora, e não há
 * de onde tirar os outros dois papéis.
 */
describe("quem tem supervisão e gerência", () => {
  it("venda de iniciante remunera os três papéis", () => {
    expect(remuneraSupervisaoEGerencia("INICIANTE")).toBe(true);
  });

  it("veterano e expert remuneram só o vendedor", () => {
    expect(remuneraSupervisaoEGerencia("VETERANO")).toBe(false);
    expect(remuneraSupervisaoEGerencia("EXPERT")).toBe(false);
  });

  it("venda sem categoria não remunera ninguém", () => {
    // Sem saber sob qual condição a venda foi feita, pagar seria pagar por
    // suposição — e o erro sairia na folha de alguém.
    expect(remuneraSupervisaoEGerencia(null)).toBe(false);
    expect(remuneraSupervisaoEGerencia(undefined)).toBe(false);
  });
});

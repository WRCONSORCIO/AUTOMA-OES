import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_ALCANCADAS_PELA_RECUPERACAO,
  recuperacaoAlcancaVenda,
} from "@/server/domain/regras";
import { avaliarEstorno } from "@/modules/apuracao/domain/rules/estorno";
import type { RegraEstornoVigente } from "@/modules/apuracao/domain/rules/estorno";

/**
 * A recuperação devolve comissão já recebida da administradora. Quem recebe
 * dela é veterano e expert — venda de iniciante é paga pela WR e não é cobrada
 * de volta. Marcar venda de iniciante como "em recuperação" afirmaria um fato
 * que não corresponde a nada.
 */
describe("alcance da recuperação", () => {
  it("alcança veterano e expert", () => {
    expect(recuperacaoAlcancaVenda("VETERANO")).toBe(true);
    expect(recuperacaoAlcancaVenda("EXPERT")).toBe(true);
  });

  it("não alcança iniciante", () => {
    expect(recuperacaoAlcancaVenda("INICIANTE")).toBe(false);
  });

  it("não alcança venda sem categoria congelada", () => {
    // Sem saber sob qual condição a venda foi feita, marcar seria supor — e a
    // suposição aqui custa dinheiro de alguém.
    expect(recuperacaoAlcancaVenda(null)).toBe(false);
    expect(recuperacaoAlcancaVenda(undefined)).toBe(false);
    expect(recuperacaoAlcancaVenda("")).toBe(false);
  });

  it("declara exatamente as duas categorias, sem surpresa", () => {
    expect([...CATEGORIAS_ALCANCADAS_PELA_RECUPERACAO]).toEqual(["VETERANO", "EXPERT"]);
  });
});

/**
 * A guarda vale na MARCAÇÃO, e não só no cálculo. Este teste mostra por quê:
 * uma regra de recuperação cadastrada sem categoria nenhuma vale para todas, e
 * aí uma venda de iniciante marcada indevidamente viraria estorno de verdade.
 */
describe("por que a guarda não pode ficar só na regra de estorno", () => {
  const regraSemCategoria: RegraEstornoVigente = {
    id: "regra-geral",
    vendedorId: null,
    tipo: "RECUPERACAO",
    categoriasVenda: [], // vazio = todas
    parcelaLimite: 6,
    percentual: 50,
    vigenteDe: new Date("2025-01-01"),
    vigenteAte: null,
  };

  it("regra sem categoria estorna até venda de iniciante marcada por engano", () => {
    const decisao = avaliarEstorno(
      {
        vendedorId: "v1",
        emRecuperacao: true,
        parcelasPagas: 1,
        dataCancelamento: new Date("2026-03-10"),
        valorReferencia: 1000,
        categoriaVenda: "INICIANTE",
      },
      [regraSemCategoria],
    );

    expect(decisao.gera).toBe(true);
    // 50% de 1000 cobrados de quem nunca recebeu da administradora. É o
    // estrago que a marcação correta impede na origem.
    if (decisao.gera) expect(decisao.valorEstorno).toBe(500);
  });

  it("a mesma venda, não marcada, não gera estorno de recuperação", () => {
    const decisao = avaliarEstorno(
      {
        vendedorId: "v1",
        emRecuperacao: false,
        parcelasPagas: 1,
        dataCancelamento: new Date("2026-03-10"),
        valorReferencia: 1000,
        categoriaVenda: "INICIANTE",
      },
      [regraSemCategoria],
    );

    // Sem regra do tipo CANCELAMENTO cadastrada, não há estorno — e o motivo
    // diz que falta configurar, em vez de deixar parecer que a venda não
    // estornava.
    expect(decisao.gera).toBe(false);
  });
});

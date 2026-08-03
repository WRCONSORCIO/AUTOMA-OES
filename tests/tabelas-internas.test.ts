import { describe, expect, it } from "vitest";
import {
  CARGA_INICIAL,
  calcularComissaoInterna,
  resolverTabelaInterna,
  wrPaga,
  type FaixaInterna,
  type TabelaInterna,
} from "@/server/domain/tabelas-internas";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Monta as tabelas a partir da mesma carga que o sistema semeia. */
const TABELAS: TabelaInterna[] = Object.entries(CARGA_INICIAL).flatMap(
  ([destino, porSegmento]) =>
    Object.entries(porSegmento).map(([segmento, faixas]): TabelaInterna => {
      const lista = (faixas ?? []) as [number, number][];
      return {
        id: `${destino}-${segmento}`,
        destino: destino as TabelaInterna["destino"],
        segmento: segmento as TabelaInterna["segmento"],
        vigenteDe: dia("2026-01-01"),
        vigenteAte: null,
        faixas: lista.map(([parcela, percentual]): FaixaInterna => ({ parcela, percentual })),
      };
    }),
);

function calcular(
  destino: TabelaInterna["destino"],
  segmento: TabelaInterna["segmento"],
  parcela: number,
  valorCredito = 200_000,
  percentualFlex: number | null = 50,
) {
  return calcularComissaoInterna({
    destino,
    segmento,
    parcela,
    valorCredito,
    percentualFlex,
    tabela: resolverTabelaInterna(TABELAS, destino, segmento, dia("2026-07-31")),
  });
}

describe("quem a WR paga", () => {
  it("novato, supervisão e gerência", () => {
    expect(wrPaga("NOVATO")).toBe(true);
    expect(wrPaga("SUPERVISOR")).toBe(true);
    expect(wrPaga("GERENCIA")).toBe(true);
  });

  it("veterano e expert recebem da administradora — as tabelas são só para estorno", () => {
    expect(wrPaga("VETERANO")).toBe(false);
    expect(wrPaga("EXPERT")).toBe(false);
  });
});

describe("percentuais da carga inicial", () => {
  it("novato imóveis: 0,5 / 0,4 / 0,3 / 0,3", () => {
    // Base de 100.000 (200.000 com flex 50).
    expect(calcular("NOVATO", "IMOVEL", 1).valor).toBe(500);
    expect(calcular("NOVATO", "IMOVEL", 2).valor).toBe(400);
    expect(calcular("NOVATO", "IMOVEL", 3).valor).toBe(300);
    expect(calcular("NOVATO", "IMOVEL", 4).valor).toBe(300);
  });

  it("novato móveis: 0,4 nas três primeiras", () => {
    expect(calcular("NOVATO", "AUTOMOVEL", 1).valor).toBe(400);
    expect(calcular("NOVATO", "AUTOMOVEL", 3).valor).toBe(400);
  });

  it("veterano imóveis pula a 2ª parcela", () => {
    expect(calcular("VETERANO", "IMOVEL", 1).percentual).toBe(0.8);
    expect(calcular("VETERANO", "IMOVEL", 2).aplicavel).toBe(false);
    expect(calcular("VETERANO", "IMOVEL", 3).percentual).toBe(0.4);
    expect(calcular("VETERANO", "IMOVEL", 6).percentual).toBe(0.4);
  });

  it("expert imóveis: 0,3 na primeira e 0,10 na 3ª e 4ª", () => {
    expect(calcular("EXPERT", "IMOVEL", 1).percentual).toBe(0.3);
    expect(calcular("EXPERT", "IMOVEL", 3).percentual).toBe(0.1);
    expect(calcular("EXPERT", "IMOVEL", 4).percentual).toBe(0.1);
  });

  it("supervisão recebe na 1ª, 3ª e 4ª", () => {
    expect(calcular("SUPERVISOR", "IMOVEL", 1).percentual).toBe(0.3);
    expect(calcular("SUPERVISOR", "IMOVEL", 2).aplicavel).toBe(false);
    expect(calcular("SUPERVISOR", "IMOVEL", 3).percentual).toBe(0.1);
    expect(calcular("SUPERVISOR", "IMOVEL", 4).percentual).toBe(0.1);
  });

  it("gerência recebe só na primeira parcela", () => {
    expect(calcular("GERENCIA", "IMOVEL", 1).percentual).toBe(0.3);
    expect(calcular("GERENCIA", "AUTOMOVEL", 1).percentual).toBe(0.3);

    for (const parcela of [2, 3, 4, 5, 6]) {
      expect(calcular("GERENCIA", "IMOVEL", parcela).aplicavel).toBe(false);
      expect(calcular("GERENCIA", "AUTOMOVEL", parcela).aplicavel).toBe(false);
    }
  });
});

describe("imóvel e automóvel são tabelas separadas", () => {
  it("o mesmo destino tem percentuais diferentes por produto", () => {
    expect(calcular("VETERANO", "IMOVEL", 1).percentual).toBe(0.8);
    expect(calcular("VETERANO", "AUTOMOVEL", 1).percentual).toBe(0.5);
  });

  it("parcela que existe num produto pode não existir no outro", () => {
    expect(calcular("VETERANO", "IMOVEL", 6).aplicavel).toBe(true);
    expect(calcular("VETERANO", "AUTOMOVEL", 6).aplicavel).toBe(false);
    expect(calcular("VETERANO", "AUTOMOVEL", 5).aplicavel).toBe(true);
  });
});

describe("a base é o crédito com o flex", () => {
  it("flex 50 reduz o crédito à metade", () => {
    const resultado = calcular("NOVATO", "IMOVEL", 1, 500_000, 50);
    expect(resultado.baseCalculo).toBe(250_000);
    expect(resultado.valor).toBe(1_250);
  });

  it("sem flex a base é o crédito inteiro", () => {
    const resultado = calcular("NOVATO", "IMOVEL", 1, 500_000, null);
    expect(resultado.baseCalculo).toBe(500_000);
    expect(resultado.valor).toBe(2_500);
  });
});

describe("quando não há o que calcular", () => {
  it("venda sem produto identificado não gera comissão", () => {
    const resultado = calcularComissaoInterna({
      destino: "NOVATO",
      segmento: null,
      parcela: 1,
      valorCredito: 200_000,
      percentualFlex: 50,
      tabela: null,
    });

    expect(resultado.regra).toBe("SEM_SEGMENTO");
    expect(resultado.valor).toBe(0);
  });

  it("parcela sem percentual diz exatamente isso", () => {
    expect(calcular("GERENCIA", "IMOVEL", 2).regra).toBe("PARCELA_SEM_PERCENTUAL");
  });
});

describe("vigência", () => {
  it("tabela que ainda não começou não vale", () => {
    const futura: TabelaInterna[] = [
      {
        id: "f",
        destino: "NOVATO",
        segmento: "IMOVEL",
        vigenteDe: dia("2027-01-01"),
        vigenteAte: null,
        faixas: [{ parcela: 1, percentual: 9 }],
      },
    ];

    expect(resolverTabelaInterna(futura, "NOVATO", "IMOVEL", dia("2026-07-31"))).toBeNull();
    expect(resolverTabelaInterna(futura, "NOVATO", "IMOVEL", dia("2027-06-01"))).not.toBeNull();
  });

  it("entre duas vigentes, vale a mais recente", () => {
    const duas: TabelaInterna[] = [
      {
        id: "antiga",
        destino: "NOVATO",
        segmento: "IMOVEL",
        vigenteDe: dia("2026-01-01"),
        vigenteAte: null,
        faixas: [{ parcela: 1, percentual: 1 }],
      },
      {
        id: "nova",
        destino: "NOVATO",
        segmento: "IMOVEL",
        vigenteDe: dia("2026-07-01"),
        vigenteAte: null,
        faixas: [{ parcela: 1, percentual: 2 }],
      },
    ];

    expect(resolverTabelaInterna(duas, "NOVATO", "IMOVEL", dia("2026-07-31"))?.id).toBe("nova");
  });
});

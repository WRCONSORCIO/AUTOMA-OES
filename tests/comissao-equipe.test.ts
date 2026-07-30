import { describe, expect, it } from "vitest";
import {
  apurarComissaoEquipe,
  calcularLiberado,
  condicaoAtendida,
  type ContextoVenda,
  type RegraPapel,
} from "@/server/domain/comissao-equipe";

const CONTEXTO_BASE: ContextoVenda = {
  valorCredito: 500_000,
  percentualFlex: 50,
  equipeId: "equipe-nikson",
  gerenciaId: "gerencia-rafael",
  equipeHabilitada: false,
  supervisaoIgualGerencia: false,
};

const contexto = (ajustes: Partial<ContextoVenda> = {}): ContextoVenda => ({
  ...CONTEXTO_BASE,
  ...ajustes,
});

const regra = (
  papel: RegraPapel["papel"],
  percentual: number,
  condicao: RegraPapel["condicao"] = "SEMPRE",
): RegraPapel => ({ id: `regra-${papel}`, papel, percentual, condicao });

describe("base de cálculo da comissão da equipe", () => {
  it("aplica o flex sobre o crédito", () => {
    const [linha] = apurarComissaoEquipe([regra("VENDEDOR", 1)], contexto());
    // 500.000 × 50% = 250.000 de base; 1% = 2.500.
    expect(linha?.baseCalculo).toBe(250_000);
    expect(linha?.valor).toBe(2_500);
  });

  it("sem flex a base é o crédito integral", () => {
    const [linha] = apurarComissaoEquipe(
      [regra("VENDEDOR", 1)],
      contexto({ percentualFlex: null }),
    );
    expect(linha?.baseCalculo).toBe(500_000);
    expect(linha?.valor).toBe(5_000);
  });

  it("arredonda o valor em duas casas", () => {
    const [linha] = apurarComissaoEquipe(
      [regra("VENDEDOR", 0.35)],
      contexto({ valorCredito: 87_431.77, percentualFlex: 30 }),
    );
    // 87.431,77 × 30% = 26.229,53 → 0,35% = 91,80.
    expect(linha?.baseCalculo).toBe(26_229.53);
    expect(linha?.valor).toBe(91.8);
  });
});

describe("papéis e condições", () => {
  const tabela: RegraPapel[] = [
    regra("VENDEDOR", 1),
    regra("SUPERVISOR", 0.5),
    regra("GERENCIA", 0.3, "SUPERVISAO_DIFERENTE_GERENCIA"),
  ];

  it("gera uma linha por papel quando todas as condições valem", () => {
    const linhas = apurarComissaoEquipe(tabela, contexto());
    expect(linhas.map((linha) => linha.papel)).toEqual([
      "VENDEDOR",
      "SUPERVISOR",
      "GERENCIA",
    ]);
  });

  it("não paga gerência quando a supervisão é o próprio gerente", () => {
    const linhas = apurarComissaoEquipe(tabela, contexto({ supervisaoIgualGerencia: true }));
    expect(linhas.map((linha) => linha.papel)).toEqual(["VENDEDOR", "SUPERVISOR"]);
  });

  it("ignora percentual zerado — a regra existe mas não paga", () => {
    const linhas = apurarComissaoEquipe([regra("VENDEDOR", 1), regra("SUPERVISOR", 0)], contexto());
    expect(linhas).toHaveLength(1);
  });

  it("não gera supervisão sem equipe nem gerência sem gerência", () => {
    const linhas = apurarComissaoEquipe(
      tabela,
      contexto({ equipeId: null, gerenciaId: null }),
    );
    expect(linhas.map((linha) => linha.papel)).toEqual(["VENDEDOR"]);
  });

  it("a condição de equipe habilitada depende da marcação da equipe", () => {
    const condicional = [regra("GERENCIA", 0.3, "EQUIPE_HABILITADA")];

    expect(apurarComissaoEquipe(condicional, contexto())).toHaveLength(0);
    expect(
      apurarComissaoEquipe(condicional, contexto({ equipeHabilitada: true })),
    ).toHaveLength(1);
  });

  it("mantém o vínculo com a regra que originou o valor", () => {
    const [linha] = apurarComissaoEquipe([regra("VENDEDOR", 1)], contexto());
    expect(linha?.regraId).toBe("regra-VENDEDOR");
  });
});

describe("condicaoAtendida", () => {
  it("SEMPRE vale em qualquer contexto", () => {
    expect(condicaoAtendida("SEMPRE", contexto({ supervisaoIgualGerencia: true }))).toBe(true);
  });

  it("SUPERVISAO_DIFERENTE_GERENCIA é o inverso da igualdade", () => {
    expect(condicaoAtendida("SUPERVISAO_DIFERENTE_GERENCIA", contexto())).toBe(true);
    expect(
      condicaoAtendida("SUPERVISAO_DIFERENTE_GERENCIA", contexto({ supervisaoIgualGerencia: true })),
    ).toBe(false);
  });
});

describe("liberação pelo recebimento das parcelas", () => {
  it("nada liberado enquanto a WR não recebe", () => {
    expect(calcularLiberado(2_500, 0, 1)).toBe(0);
  });

  it("com liberação em uma parcela, o primeiro recebimento libera tudo", () => {
    expect(calcularLiberado(2_500, 1, 1)).toBe(2_500);
    expect(calcularLiberado(2_500, 3, 1)).toBe(2_500);
  });

  it("libera proporcionalmente quando exige mais parcelas", () => {
    expect(calcularLiberado(2_500, 1, 4)).toBe(625);
    expect(calcularLiberado(2_500, 2, 4)).toBe(1_250);
    expect(calcularLiberado(2_500, 4, 4)).toBe(2_500);
  });

  it("nunca libera mais do que o previsto", () => {
    expect(calcularLiberado(2_500, 9, 4)).toBe(2_500);
  });
});

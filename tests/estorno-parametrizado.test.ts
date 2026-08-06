import { describe, expect, it } from "vitest";
import {
  avaliarEstorno,
  resolverRegra,
  tipoDoEstorno,
  type FatoCancelamento,
  type RegraEstornoVigente,
} from "@/modules/apuracao/domain/rules/estorno";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const regra = (over: Partial<RegraEstornoVigente> = {}): RegraEstornoVigente => ({
  id: "padrao",
  vendedorId: null,
  tipo: "RECUPERACAO",
  parcelaLimite: 6,
  percentual: 100,
  vigenteDe: dia("2024-01-01"),
  vigenteAte: null,
  ...over,
});

const fato = (over: Partial<FatoCancelamento> = {}): FatoCancelamento => ({
  vendedorId: "vend-1",
  emRecuperacao: true,
  parcelasPagas: 2,
  dataCancelamento: dia("2025-06-10"),
  valorReferencia: 1000,
  ...over,
});

describe("tipo do estorno", () => {
  it("venda marcada em recuperação estorna como RECUPERACAO", () => {
    expect(tipoDoEstorno(fato({ emRecuperacao: true }))).toBe("RECUPERACAO");
  });

  it("venda fora de recuperação estorna como CANCELAMENTO", () => {
    expect(tipoDoEstorno(fato({ emRecuperacao: false }))).toBe("CANCELAMENTO");
  });
});

describe("resolução da regra vigente", () => {
  it("a regra do vendedor vence a regra padrão da WR", () => {
    const escolhida = resolverRegra(
      [regra(), regra({ id: "do-vendedor", vendedorId: "vend-1", percentual: 50 })],
      "RECUPERACAO",
      "vend-1",
      dia("2025-06-10"),
    );
    expect(escolhida?.id).toBe("do-vendedor");
  });

  it("a regra de outro vendedor é ignorada", () => {
    const escolhida = resolverRegra(
      [regra(), regra({ id: "de-outro", vendedorId: "vend-2", percentual: 10 })],
      "RECUPERACAO",
      "vend-1",
      dia("2025-06-10"),
    );
    expect(escolhida?.id).toBe("padrao");
  });

  it("entre duas do mesmo nível, vence a de vigência mais recente", () => {
    const escolhida = resolverRegra(
      [
        regra({ id: "antiga", vigenteDe: dia("2024-01-01") }),
        regra({ id: "nova", vigenteDe: dia("2025-01-01") }),
      ],
      "RECUPERACAO",
      "vend-1",
      dia("2025-06-10"),
    );
    expect(escolhida?.id).toBe("nova");
  });

  it("resolve pela data do FATO, não por hoje — regra nova não reescreve o passado", () => {
    const regras = [
      regra({ id: "antiga", percentual: 100, vigenteDe: dia("2024-01-01"), vigenteAte: dia("2024-12-31") }),
      regra({ id: "nova", percentual: 50, vigenteDe: dia("2025-01-01") }),
    ];
    expect(resolverRegra(regras, "RECUPERACAO", "vend-1", dia("2024-06-01"))?.id).toBe("antiga");
    expect(resolverRegra(regras, "RECUPERACAO", "vend-1", dia("2025-06-01"))?.id).toBe("nova");
  });

  it("não mistura os dois tipos", () => {
    const escolhida = resolverRegra(
      [regra({ id: "cancel", tipo: "CANCELAMENTO" })],
      "RECUPERACAO",
      "vend-1",
      dia("2025-06-10"),
    );
    expect(escolhida).toBeNull();
  });
});

describe("avaliação do estorno", () => {
  it("cancelamento abaixo do limite gera estorno pelo percentual da regra", () => {
    const decisao = avaliarEstorno(fato({ parcelasPagas: 2 }), [regra({ percentual: 100 })]);
    expect(decisao.gera).toBe(true);
    if (decisao.gera) {
      expect(decisao.valorEstorno).toBe(1000);
      expect(decisao.tipo).toBe("RECUPERACAO");
    }
  });

  it("percentual parcial por vendedor é respeitado", () => {
    const decisao = avaliarEstorno(fato(), [
      regra(),
      regra({ id: "meio", vendedorId: "vend-1", percentual: 50 }),
    ]);
    expect(decisao.gera).toBe(true);
    if (decisao.gera) expect(decisao.valorEstorno).toBe(500);
  });

  it("no limite exato NÃO estorna — a regra é estritamente abaixo", () => {
    const decisao = avaliarEstorno(fato({ parcelasPagas: 6 }), [regra({ parcelaLimite: 6 })]);
    expect(decisao.gera).toBe(false);
  });

  it("limite zero desliga o estorno para o vendedor", () => {
    const decisao = avaliarEstorno(fato({ parcelasPagas: 0 }), [
      regra({ vendedorId: "vend-1", parcelaLimite: 0 }),
    ]);
    expect(decisao.gera).toBe(false);
  });

  it("cota não cancelada nunca estorna", () => {
    const decisao = avaliarEstorno(fato({ dataCancelamento: null }), [regra()]);
    expect(decisao.gera).toBe(false);
  });

  it("sem regra cadastrada não estorna, e diz que falta configurar", () => {
    const decisao = avaliarEstorno(fato(), []);
    expect(decisao.gera).toBe(false);
    expect(decisao.motivo).toContain("Sem regra de estorno vigente");
  });

  it("cancelamento anos depois ainda estorna se a venda foi em recuperação", () => {
    const decisao = avaliarEstorno(
      fato({ dataCancelamento: dia("2029-11-30"), parcelasPagas: 1 }),
      [regra()],
    );
    expect(decisao.gera).toBe(true);
  });

  it("o valor do estorno é sempre positivo, mesmo com referência negativa", () => {
    const decisao = avaliarEstorno(fato({ valorReferencia: -1000 }), [regra()]);
    expect(decisao.gera).toBe(true);
    if (decisao.gera) expect(decisao.valorEstorno).toBe(1000);
  });

  it("o motivo explica também quando NÃO gera", () => {
    const decisao = avaliarEstorno(fato({ parcelasPagas: 9 }), [regra({ parcelaLimite: 6 })]);
    expect(decisao.gera).toBe(false);
    expect(decisao.motivo).toContain("9 parcela(s) paga(s)");
  });
});

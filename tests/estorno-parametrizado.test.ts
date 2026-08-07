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
  categoriasVenda: [],
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
  categoriaVenda: "VETERANO",
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

/**
 * A regra antiga (`deveGerarEstorno`, com `PARCELA_LIMITE_ESTORNO = 6`) foi
 * removida. Estes casos são os mesmos que ela tinha, agora resolvidos pela
 * regra padrão que a migração semeia — a prova de que a parametrização entrou
 * sem mudar um centavo do comportamento.
 */
describe("equivalência com a regra que era constante no código", () => {
  // Exatamente o que a migração 20260807100000 grava no banco.
  const padraoSemeada = regra({
    id: "regra_estorno_padrao_recuperacao",
    vendedorId: null,
    tipo: "RECUPERACAO",
    categoriasVenda: [],
    parcelaLimite: 6,
    percentual: 100,
    vigenteDe: dia("1900-01-01"),
    vigenteAte: null,
  });

  const gera = (over: Partial<FatoCancelamento>) =>
    avaliarEstorno(fato(over), [padraoSemeada]).gera;

  it("cancelamento antes da 6ª parcela gera estorno", () => {
    expect(gera({ emRecuperacao: true, parcelasPagas: 5, dataCancelamento: dia("2029-04-01") })).toBe(true);
  });

  it("cancelamento na 6ª parcela não gera estorno", () => {
    expect(gera({ emRecuperacao: true, parcelasPagas: 6, dataCancelamento: dia("2029-04-01") })).toBe(false);
  });

  it("sem regra de CANCELAMENTO no conjunto, venda fora de recuperação não estorna", () => {
    expect(gera({ emRecuperacao: false, parcelasPagas: 1, dataCancelamento: dia("2026-09-01") })).toBe(false);
  });

  it("sem cancelamento não há estorno", () => {
    expect(gera({ emRecuperacao: true, parcelasPagas: 0, dataCancelamento: null })).toBe(false);
  });

  it("a regra vale mesmo anos depois da venda", () => {
    expect(gera({ emRecuperacao: true, parcelasPagas: 3, dataCancelamento: dia("2031-12-20") })).toBe(true);
  });

  it("cobre cancelamento de venda antiga — a vigência começa em 1900", () => {
    expect(gera({ emRecuperacao: true, parcelasPagas: 1, dataCancelamento: dia("2019-03-15") })).toBe(true);
  });
});

/**
 * As duas situações de estorno, como a WR as definiu.
 *
 * Ambas valem SOMENTE para veterano e expert — as categorias que recebem
 * direto da administradora. Venda de iniciante é paga pela WR à própria equipe
 * e nunca é cobrada de volta.
 */
describe("as duas situações de estorno", () => {
  // Exatamente o que a migração 20260807140000 grava no banco.
  const cancelamentoVeterano = regra({
    id: "regra_estorno_padrao_cancelamento_veterano",
    vendedorId: null,
    tipo: "CANCELAMENTO",
    categoriasVenda: ["VETERANO", "EXPERT"],
    parcelaLimite: 2,
    percentual: 100,
    vigenteDe: dia("1900-01-01"),
  });

  const recuperacaoPadrao = regra({
    id: "regra_estorno_padrao_recuperacao",
    categoriasVenda: ["VETERANO", "EXPERT"],
    vigenteDe: dia("1900-01-01"),
  });

  const cenario = [cancelamentoVeterano, recuperacaoPadrao];
  const fora = (over: Partial<FatoCancelamento>) =>
    avaliarEstorno(fato({ emRecuperacao: false, ...over }), cenario);

  it("venda veterana cancelada com 1 parcela paga estorna", () => {
    const decisao = fora({ parcelasPagas: 1, categoriaVenda: "VETERANO" });
    expect(decisao.gera).toBe(true);
    if (decisao.gera) {
      expect(decisao.tipo).toBe("CANCELAMENTO");
      expect(decisao.valorEstorno).toBe(1000);
    }
  });

  it("venda veterana cancelada sem nenhuma parcela paga também estorna", () => {
    expect(fora({ parcelasPagas: 0, categoriaVenda: "VETERANO" }).gera).toBe(true);
  });

  it("venda veterana cancelada com 2 parcelas pagas NÃO estorna", () => {
    expect(fora({ parcelasPagas: 2, categoriaVenda: "VETERANO" }).gera).toBe(false);
  });

  it("venda de INICIANTE não estorna por cancelamento", () => {
    expect(fora({ parcelasPagas: 1, categoriaVenda: "INICIANTE" }).gera).toBe(false);
  });

  it("venda de EXPERT cancelada com 1 parcela paga também estorna", () => {
    expect(fora({ parcelasPagas: 1, categoriaVenda: "EXPERT" }).gera).toBe(true);
  });

  it("venda sem categoria congelada não estorna — melhor que estornar por suposição", () => {
    expect(fora({ parcelasPagas: 1, categoriaVenda: null }).gera).toBe(false);
  });

  it("recuperação de venda INICIANTE NÃO estorna — a WR paga essa comissão, não cobra de volta", () => {
    const decisao = avaliarEstorno(
      fato({ emRecuperacao: true, parcelasPagas: 3, categoriaVenda: "INICIANTE" }),
      cenario,
    );
    expect(decisao.gera).toBe(false);
  });

  it("recuperação de venda VETERANA estorna", () => {
    const decisao = avaliarEstorno(
      fato({ emRecuperacao: true, parcelasPagas: 3, categoriaVenda: "VETERANO" }),
      cenario,
    );
    expect(decisao.gera).toBe(true);
    if (decisao.gera) expect(decisao.tipo).toBe("RECUPERACAO");
  });

  it("recuperação de venda EXPERT estorna", () => {
    const decisao = avaliarEstorno(
      fato({ emRecuperacao: true, parcelasPagas: 3, categoriaVenda: "EXPERT" }),
      cenario,
    );
    expect(decisao.gera).toBe(true);
  });

  it("venda veterana em recuperação usa a regra de recuperação, não a de cancelamento", () => {
    // Com 3 parcelas pagas passaria do limite 2 do cancelamento, mas está
    // dentro do limite 6 da recuperação. A marcação de recuperação manda.
    const decisao = avaliarEstorno(
      fato({ emRecuperacao: true, parcelasPagas: 3, categoriaVenda: "VETERANO" }),
      cenario,
    );
    expect(decisao.gera).toBe(true);
    if (decisao.gera) expect(decisao.tipo).toBe("RECUPERACAO");
  });
});

describe("precedência entre vendedor e categoria", () => {
  const geral = regra({ id: "geral", vendedorId: null, categoriasVenda: [], percentual: 100 });
  const porCategoria = regra({ id: "por-categoria", vendedorId: null, categoriasVenda: ["VETERANO"], percentual: 80 });
  const porVendedor = regra({ id: "por-vendedor", vendedorId: "vend-1", categoriasVenda: [], percentual: 60 });
  const porAmbos = regra({ id: "por-ambos", vendedorId: "vend-1", categoriasVenda: ["VETERANO"], percentual: 40 });

  const escolher = (regras: RegraEstornoVigente[]) =>
    resolverRegra(regras, "RECUPERACAO", "vend-1", dia("2025-06-10"), "VETERANO")?.id;

  it("regra do vendedor para a categoria vence tudo", () => {
    expect(escolher([geral, porCategoria, porVendedor, porAmbos])).toBe("por-ambos");
  });

  it("o vendedor pesa mais que a categoria", () => {
    expect(escolher([geral, porCategoria, porVendedor])).toBe("por-vendedor");
  });

  it("sem regra do vendedor, a da categoria vence a geral", () => {
    expect(escolher([geral, porCategoria])).toBe("por-categoria");
  });

  it("a geral é o último recurso", () => {
    expect(escolher([geral])).toBe("geral");
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

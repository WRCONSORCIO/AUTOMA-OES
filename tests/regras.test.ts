import { describe, expect, it } from "vitest";
import {
  calcularBaseComissao,
  calcularComissaoWr,
  chaveDuplicidade,
  deveGerarEstorno,
  encontrarRecuperacaoNaData,
  identificarTipoLancamento,
  montarIdentidadeCota,
  resolverCategoriaNaData,
  resolverParcela,
  resolverVendedorEfetivo,
  saoDuplicados,
} from "@/server/domain/regras";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("períodos que se sobrepõem no mesmo dia", () => {
  // O cadastro nasce Iniciante e a categoria é trocada no mesmo dia: os dois
  // períodos começam na mesma data, e desempatar por ordem de chegada fazia a
  // troca "não salvar".
  it("o período encerrado antes de começar nunca vale", () => {
    const historico = [
      { categoria: "INICIANTE" as const, vigenteDe: dia("2026-07-31"), vigenteAte: dia("2026-07-30") },
      { categoria: "EXPERT" as const, vigenteDe: dia("2026-07-31"), vigenteAte: null },
    ];

    expect(resolverCategoriaNaData(historico, dia("2026-07-31"))).toBe("EXPERT");
    expect(resolverCategoriaNaData(historico, dia("2026-08-15"))).toBe("EXPERT");
  });

  it("período que começa no futuro não vale hoje", () => {
    const historico = [
      { categoria: "INICIANTE" as const, vigenteDe: dia("2026-07-01"), vigenteAte: dia("2026-08-29") },
      { categoria: "EXPERT" as const, vigenteDe: dia("2026-08-30"), vigenteAte: null },
    ];

    expect(resolverCategoriaNaData(historico, dia("2026-07-31"))).toBe("INICIANTE");
    expect(resolverCategoriaNaData(historico, dia("2026-08-30"))).toBe("EXPERT");
  });
});

describe("categoria pertence à venda, não ao vendedor", () => {
  // Pedro: Iniciante desde 01/01, Veterano a partir de 15/07, Expert em 20/02/2027.
  const historico = [
    { categoria: "INICIANTE" as const, vigenteDe: dia("2026-01-01"), vigenteAte: dia("2026-07-14") },
    { categoria: "VETERANO" as const, vigenteDe: dia("2026-07-15"), vigenteAte: dia("2027-02-19") },
    { categoria: "EXPERT" as const, vigenteDe: dia("2027-02-20"), vigenteAte: null },
  ];

  it("venda de março continua sendo de Iniciante", () => {
    expect(resolverCategoriaNaData(historico, dia("2026-03-10"))).toBe("INICIANTE");
  });

  it("venda no último dia do período de Iniciante ainda é Iniciante", () => {
    expect(resolverCategoriaNaData(historico, dia("2026-07-14"))).toBe("INICIANTE");
  });

  it("venda no primeiro dia de Veterano já usa Veterano", () => {
    expect(resolverCategoriaNaData(historico, dia("2026-07-15"))).toBe("VETERANO");
  });

  it("venda posterior à promoção a Expert usa Expert", () => {
    expect(resolverCategoriaNaData(historico, dia("2027-06-01"))).toBe("EXPERT");
  });

  it("venda anterior a qualquer período não tem categoria", () => {
    expect(resolverCategoriaNaData(historico, dia("2025-12-31"))).toBeNull();
  });

  it("vendedor sem histórico não resolve categoria", () => {
    expect(resolverCategoriaNaData([], dia("2026-03-10"))).toBeNull();
  });
});

describe("recuperação marca a venda pelo período", () => {
  const periodos = [
    { id: "rec-1", dataInicio: dia("2026-07-01"), dataFim: dia("2026-12-31") },
  ];

  it("venda dentro do intervalo é marcada", () => {
    expect(encontrarRecuperacaoNaData(periodos, dia("2026-08-15"))?.id).toBe("rec-1");
  });

  it("os limites do intervalo são inclusivos", () => {
    expect(encontrarRecuperacaoNaData(periodos, dia("2026-07-01"))?.id).toBe("rec-1");
    expect(encontrarRecuperacaoNaData(periodos, dia("2026-12-31"))?.id).toBe("rec-1");
  });

  it("venda fora do intervalo não é marcada", () => {
    expect(encontrarRecuperacaoNaData(periodos, dia("2026-06-30"))).toBeNull();
    expect(encontrarRecuperacaoNaData(periodos, dia("2027-01-01"))).toBeNull();
  });
});

describe("estorno de venda em recuperação", () => {
  it("cancelamento antes da 6ª parcela gera estorno", () => {
    expect(
      deveGerarEstorno({
        emRecuperacao: true,
        parcelasPagas: 5,
        dataCancelamento: dia("2029-04-01"),
      }),
    ).toBe(true);
  });

  it("cancelamento na 6ª parcela não gera estorno", () => {
    expect(
      deveGerarEstorno({
        emRecuperacao: true,
        parcelasPagas: 6,
        dataCancelamento: dia("2029-04-01"),
      }),
    ).toBe(false);
  });

  it("venda fora de recuperação nunca gera estorno", () => {
    expect(
      deveGerarEstorno({
        emRecuperacao: false,
        parcelasPagas: 1,
        dataCancelamento: dia("2026-09-01"),
      }),
    ).toBe(false);
  });

  it("sem cancelamento não há estorno", () => {
    expect(
      deveGerarEstorno({ emRecuperacao: true, parcelasPagas: 0, dataCancelamento: null }),
    ).toBe(false);
  });

  it("a regra vale mesmo anos depois da venda", () => {
    expect(
      deveGerarEstorno({
        emRecuperacao: true,
        parcelasPagas: 3,
        dataCancelamento: dia("2031-12-20"),
      }),
    ).toBe(true);
  });
});

describe("inclusão de plano é sempre parcela 1", () => {
  it("ignora qualquer parcela informada no relatório", () => {
    expect(resolverParcela("INCLUSAO_DE_PLANO", 7)).toBe(1);
    expect(resolverParcela("INCLUSAO_DE_PLANO", null)).toBe(1);
  });

  it("pagamento de comissão mantém a parcela do relatório", () => {
    expect(resolverParcela("PAGAMENTO_COMISSAO", 9)).toBe(9);
  });

  it("identifica os tipos do relatório", () => {
    expect(identificarTipoLancamento("INCLUSAO DE PLANO")).toBe("INCLUSAO_DE_PLANO");
    expect(identificarTipoLancamento("PAGAMENTO COMISSAO")).toBe("PAGAMENTO_COMISSAO");
    expect(identificarTipoLancamento("CANCELAMENTO DE PLANO")).toBe("CANCELAMENTO_DE_PLANO");
    expect(identificarTipoLancamento("EXCLUSAO DE PLANO")).toBeNull();
  });
});

describe("flex define a base de cálculo", () => {
  it("crédito de 500 mil com Flex 50 gera base de 250 mil", () => {
    expect(calcularBaseComissao(500_000, 50)).toBe(250_000);
  });

  it("Flex 30 usa 30% do crédito", () => {
    expect(calcularBaseComissao(500_000, 30)).toBe(150_000);
  });

  it("sem flex a base é o crédito integral", () => {
    expect(calcularBaseComissao(500_000, null)).toBe(500_000);
    expect(calcularBaseComissao(500_000, 100)).toBe(500_000);
  });
});

describe("o que a WR recebe da administradora", () => {
  // O relatório de fechamento é a fonte da verdade: a administradora sabe
  // quanto deve. A categoria do vendedor não entra nesta conta — ela decide
  // quanto a WR repassa, que é o caminho inverso.
  it("registra o valor que o relatório informou", () => {
    const resultado = calcularComissaoWr({
      valorComissao: 825,
      valorDsr: 0,
      valorSeguro: 0,
      percentualRelatorio: 1.5,
      valorCredito: 110_000,
      percentualFlex: 50,
      tipo: "INCLUSAO_DE_PLANO",
    });

    expect(resultado.aplicavel).toBe(true);
    expect(resultado.valor).toBe(825);
    expect(resultado.percentual).toBe(1.5);
    expect(resultado.baseCalculo).toBe(55_000);
    expect(resultado.regra).toBe("RELATORIO_ADMINISTRADORA");
  });

  it("a venda sem categoria continua gerando comissão para a WR", () => {
    const resultado = calcularComissaoWr({
      valorComissao: 625,
      valorDsr: 0,
      valorSeguro: 0,
      percentualRelatorio: 0.5,
      valorCredito: 250_000,
      percentualFlex: 50,
      tipo: "PAGAMENTO_COMISSAO",
    });

    expect(resultado.valor).toBe(625);
  });

  it("qualquer parcela conta — não existe parcela fora da tabela aqui", () => {
    const resultado = calcularComissaoWr({
      valorComissao: 250,
      valorDsr: 0,
      valorSeguro: 0,
      percentualRelatorio: 0.5,
      valorCredito: 100_000,
      percentualFlex: 50,
      tipo: "PAGAMENTO_COMISSAO",
    });

    expect(resultado.valor).toBe(250);
  });

  it("cancelamento chega negativo no relatório e é registrado como estorno", () => {
    const resultado = calcularComissaoWr({
      valorComissao: -4_000,
      valorDsr: 0,
      valorSeguro: 0,
      percentualRelatorio: 4,
      valorCredito: 200_000,
      percentualFlex: 50,
      tipo: "CANCELAMENTO_DE_PLANO",
    });

    expect(resultado.valor).toBe(-4_000);
    expect(resultado.regra).toBe("RELATORIO_ESTORNO");
  });

  it("soma DSR e seguro: é assim que o relatório fecha o total", () => {
    // No fechamento de 22/07 o rodapé soma as três colunas:
    // 261.090,87 de comissão + 0,00 de DSR + 138,83 de seguro = 261.229,70.
    const resultado = calcularComissaoWr({
      valorComissao: 825,
      valorDsr: 12.5,
      valorSeguro: 3.33,
      percentualRelatorio: 1.5,
      valorCredito: 110_000,
      percentualFlex: 50,
      tipo: "PAGAMENTO_COMISSAO",
    });

    expect(resultado.valor).toBe(840.83);
  });

  it("o imposto de renda não é abatido — o recebido é o valor cheio", () => {
    const resultado = calcularComissaoWr({
      valorComissao: 1_000,
      valorDsr: null,
      valorSeguro: null,
      percentualRelatorio: null,
      valorCredito: 200_000,
      percentualFlex: 50,
      tipo: "PAGAMENTO_COMISSAO",
    });

    expect(resultado.valor).toBe(1_000);
  });

  it("sem percentual impresso, deriva o efetivo sobre a base", () => {
    const resultado = calcularComissaoWr({
      valorComissao: 1_000,
      valorDsr: 0,
      valorSeguro: 0,
      percentualRelatorio: null,
      valorCredito: 200_000,
      percentualFlex: 50,
      tipo: "PAGAMENTO_COMISSAO",
    });

    // 1.000 sobre a base de 100.000 = 1%.
    expect(resultado.percentual).toBe(1);
  });
});

describe("identidade da cota", () => {
  const base = {
    administradoraId: "adm-1",
    contrato: "53818I10  ",
    grupo: "1574.0",
    cota: "3162-2",
    cpfCnpjCliente: "06.968.698/0001-10",
  };

  it("normaliza contrato, grupo, cota e documento", () => {
    expect(montarIdentidadeCota(base)).toEqual({
      administradoraId: "adm-1",
      contrato: "53818I10",
      grupo: "1574",
      cota: "3162-2",
      cpfCnpjCliente: "06968698000110",
    });
  });

  it("a cota do PDF (com dígito separado por ponto) casa com a do CSV", () => {
    const doCsv = montarIdentidadeCota({ ...base, cota: "2754-4" });
    const doPdf = montarIdentidadeCota({ ...base, cota: "2754.4" });
    expect(doPdf).toEqual(doCsv);
  });
});

describe("duplicidade exige os sete campos iguais", () => {
  const registro = {
    administradoraId: "adm-1",
    contrato: "53818I10",
    grupo: "1574",
    cota: "3162-2",
    cpfCnpjCliente: "06968698000110",
    nomeCliente: "ANTONIO AUGUSTO GIL DE SOUSA",
    cpfCnpjVendedor: "42505181000158",
  };

  it("registros idênticos são duplicados", () => {
    expect(saoDuplicados(registro, { ...registro })).toBe(true);
  });

  it("mesmo CPF do cliente com cota diferente não é duplicado", () => {
    expect(saoDuplicados(registro, { ...registro, cota: "3162-3" })).toBe(false);
  });

  it("vendedor diferente não é duplicado", () => {
    expect(saoDuplicados(registro, { ...registro, cpfCnpjVendedor: "12815281619" })).toBe(false);
  });

  it("nome do cliente diferente não é duplicado", () => {
    expect(saoDuplicados(registro, { ...registro, nomeCliente: "OUTRO CLIENTE" })).toBe(false);
  });

  it("acentuação e espaços no nome não criam falso negativo", () => {
    expect(
      chaveDuplicidade({ ...registro, nomeCliente: "  Antônio  Augusto Gil de Sousa " }),
    ).toBe(chaveDuplicidade(registro));
  });
});

describe("precedência do vendedor", () => {
  it("o override interno da WR vence o vendedor da administradora", () => {
    expect(
      resolverVendedorEfetivo({
        vendedorOverrideId: "wr-1",
        vendedorAdministradoraId: "adm-1",
      }),
    ).toEqual({ vendedorId: "wr-1", origem: "OVERRIDE_WR" });
  });

  it("sem override, vale o vendedor da administradora", () => {
    expect(
      resolverVendedorEfetivo({
        vendedorOverrideId: null,
        vendedorAdministradoraId: "adm-1",
      }),
    ).toEqual({ vendedorId: "adm-1", origem: "ADMINISTRADORA" });
  });

  it("sem nenhum dos dois o vendedor fica não identificado", () => {
    expect(
      resolverVendedorEfetivo({ vendedorOverrideId: null, vendedorAdministradoraId: null }),
    ).toEqual({ vendedorId: null, origem: "NAO_IDENTIFICADO" });
  });
});

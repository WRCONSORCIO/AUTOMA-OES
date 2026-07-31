import { describe, expect, it } from "vitest";
import { normalizarSegmento } from "@/server/domain/regras";
import { resolverPorVigencia, type ComVigencia } from "@/server/domain/vigencia";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("segmento do bem", () => {
  it("reconhece o que a base manda", () => {
    expect(normalizarSegmento("IMOVEL")).toBe("IMOVEL");
    expect(normalizarSegmento("MOVEL")).toBe("AUTOMOVEL");
  });

  it("reconhece o produto por extenso do relatório de comissão", () => {
    expect(normalizarSegmento("CREDITO P/IMOVEL 015")).toBe("IMOVEL");
    expect(normalizarSegmento("CREDITO P/MOVEL 21")).toBe("AUTOMOVEL");
  });

  it("não confunde IMOVEL com MOVEL — um contém o outro", () => {
    expect(normalizarSegmento("CREDITO P/IMOVEL 200")).toBe("IMOVEL");
    expect(normalizarSegmento("IMOVEL")).not.toBe("AUTOMOVEL");
  });

  it("aceita como a WR fala", () => {
    expect(normalizarSegmento("Automóvel")).toBe("AUTOMOVEL");
    expect(normalizarSegmento("veículo")).toBe("AUTOMOVEL");
    expect(normalizarSegmento("imobiliário")).toBe("IMOVEL");
  });

  it("texto desconhecido fica sem segmento, para cair na tabela geral", () => {
    expect(normalizarSegmento("SERVICOS")).toBeNull();
    expect(normalizarSegmento("")).toBeNull();
    expect(normalizarSegmento(null)).toBeNull();
  });
});

interface Tabela extends ComVigencia {
  nome: string;
}

const tabela = (
  nome: string,
  categoria: Tabela["categoria"],
  segmento: Tabela["segmento"],
  vigenteDe: string,
  vigenteAte: string | null = null,
): Tabela => ({
  nome,
  categoria,
  segmento,
  vigenteDe: dia(vigenteDe),
  vigenteAte: vigenteAte ? dia(vigenteAte) : null,
});

describe("escolha da tabela por vigência e segmento", () => {
  const tabelas = [
    tabela("Expert geral", "EXPERT", null, "2026-01-01"),
    tabela("Expert imóvel", "EXPERT", "IMOVEL", "2026-07-01"),
    tabela("Expert automóvel", "EXPERT", "AUTOMOVEL", "2026-07-01"),
    tabela("Iniciante geral", "INICIANTE", null, "2026-01-01"),
  ];

  it("a tabela do segmento vence a geral", () => {
    expect(resolverPorVigencia(tabelas, "EXPERT", "IMOVEL", dia("2026-07-31"))?.nome).toBe(
      "Expert imóvel",
    );
    expect(resolverPorVigencia(tabelas, "EXPERT", "AUTOMOVEL", dia("2026-07-31"))?.nome).toBe(
      "Expert automóvel",
    );
  });

  it("sem tabela do segmento, vale a geral", () => {
    expect(resolverPorVigencia(tabelas, "INICIANTE", "IMOVEL", dia("2026-07-31"))?.nome).toBe(
      "Iniciante geral",
    );
  });

  it("venda sem segmento identificado usa a geral", () => {
    expect(resolverPorVigencia(tabelas, "EXPERT", null, dia("2026-07-31"))?.nome).toBe(
      "Expert geral",
    );
  });

  it("criar a de automóvel não pode roubar as vendas de imóvel", () => {
    const antes = resolverPorVigencia(tabelas, "EXPERT", "IMOVEL", dia("2026-07-31"));
    expect(antes?.segmento).toBe("IMOVEL");
  });

  it("a vigência é resolvida pela data da venda, não por hoje", () => {
    // Venda de junho: a tabela de imóvel só passa a valer em julho.
    expect(resolverPorVigencia(tabelas, "EXPERT", "IMOVEL", dia("2026-06-15"))?.nome).toBe(
      "Expert geral",
    );
  });

  it("tabela encerrada não vale depois do fim", () => {
    const encerradas = [
      tabela("Antiga", "EXPERT", null, "2026-01-01", "2026-06-30"),
      tabela("Nova", "EXPERT", null, "2026-07-01"),
    ];

    expect(resolverPorVigencia(encerradas, "EXPERT", null, dia("2026-06-30"))?.nome).toBe("Antiga");
    expect(resolverPorVigencia(encerradas, "EXPERT", null, dia("2026-07-01"))?.nome).toBe("Nova");
  });

  it("sem tabela para a categoria, nada é devolvido", () => {
    expect(resolverPorVigencia(tabelas, "VETERANO", "IMOVEL", dia("2026-07-31"))).toBeNull();
  });

  it("venda anterior a qualquer vigência não encontra tabela", () => {
    expect(resolverPorVigencia(tabelas, "EXPERT", "IMOVEL", dia("2025-12-31"))).toBeNull();
  });
});

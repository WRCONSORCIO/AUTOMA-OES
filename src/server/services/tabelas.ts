import "server-only";

import type { CategoriaVendedor, SegmentoVenda } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FaixaParcela } from "@/server/domain/regras";
import { resolverPorVigencia, type ComVigencia } from "@/server/domain/vigencia";

/**
 * Tabelas de comissão que a administradora paga PARA a WR.
 *
 * Carregadas por inteiro e resolvidas em memória: são poucas dezenas de linhas
 * e cada lançamento precisa da tabela vigente na data da SUA venda, o que uma
 * consulta por lançamento tornaria caro.
 */

export interface TabelaWr extends ComVigencia {
  id: string;
  nome: string;
  faixas: FaixaParcela[];
}

export async function carregarTabelasWr(): Promise<TabelaWr[]> {
  const tabelas = await prisma.tabelaComissao.findMany({
    where: { ativo: true },
    include: { faixas: { orderBy: { parcela: "asc" } } },
    orderBy: [{ categoria: "asc" }, { vigenteDe: "desc" }],
  });

  return tabelas.map((tabela) => ({
    id: tabela.id,
    nome: tabela.nome,
    categoria: tabela.categoria,
    segmento: tabela.segmento,
    vigenteDe: tabela.vigenteDe,
    vigenteAte: tabela.vigenteAte,
    faixas: tabela.faixas.map((faixa) => ({
      parcela: faixa.parcela,
      percentual: Number(faixa.percentual),
    })),
  }));
}

export function resolverTabelaWr(
  tabelas: readonly TabelaWr[],
  categoria: CategoriaVendedor | null,
  segmento: SegmentoVenda | null,
  data: Date | null,
): TabelaWr | null {
  if (!categoria) return null;
  return resolverPorVigencia(tabelas, categoria, segmento, data ?? new Date());
}

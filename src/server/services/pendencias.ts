import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EscopoDados } from "@/server/auth/rbac";

export interface PendenciaCadastro {
  vendedorId: string;
  nome: string;
  cpfCnpj: string;
  criadoPelaImportacao: boolean;
  temHistoricoCategoria: boolean;
  equipeNome: string | null;
  gerenciaNome: string | null;
  equipeId: string | null;
  gerenciaId: string | null;
  cotasSemCategoria: number;
  lancamentosBloqueados: number;
  /** Valor que a administradora pagou e que ainda não gerou comissão WR. */
  valorBloqueado: number;
  primeiraVenda: Date | null;
  ultimaVenda: Date | null;
}

export interface ResumoPendencias {
  itens: PendenciaCadastro[];
  totalVendedores: number;
  totalLancamentos: number;
  totalCotas: number;
  valorTotalBloqueado: number;
}

interface LinhaAgregada {
  vendedorId: string;
  cotas_sem_categoria: bigint;
  lancamentos: bigint;
  valor: Prisma.Decimal | null;
  primeira_venda: Date | null;
  ultima_venda: Date | null;
}

/**
 * Levanta os vendedores cujas vendas não geram comissão WR por falta de
 * categoria vigente na data da venda.
 *
 * Cobre dois casos: o vendedor criado automaticamente pela importação da base
 * (que nasce sem histórico de categoria) e o vendedor cujo histórico começa
 * depois de vendas já importadas.
 */
export async function carregarPendenciasCadastro(
  escopo: EscopoDados,
): Promise<ResumoPendencias> {
  const filtros: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (escopo.gerenciaId) {
    filtros.push(Prisma.sql`v."gerenciaId" = ${escopo.gerenciaId}`);
  }
  if (escopo.equipeId) {
    filtros.push(Prisma.sql`v."equipeId" = ${escopo.equipeId}`);
  }
  const condicoes = Prisma.join(filtros, " AND ");

  const linhas = await prisma.$queryRaw<LinhaAgregada[]>`
    WITH cotas_pendentes AS (
      SELECT c."vendedorEfetivoId" AS vendedor_id,
             COUNT(*)              AS quantidade,
             MIN(c."dataVenda")    AS primeira,
             MAX(c."dataVenda")    AS ultima
        FROM "Cota" c
       WHERE c."categoriaVenda" IS NULL
         AND c."vendedorEfetivoId" IS NOT NULL
       GROUP BY 1
    ),
    lancamentos_pendentes AS (
      SELECT cr."vendedorId"           AS vendedor_id,
             COUNT(*)                  AS quantidade,
             SUM(cr."valorComissao")   AS valor,
             MIN(cr."dataVenda")       AS primeira,
             MAX(cr."dataVenda")       AS ultima
        FROM "ComissaoRegistro" cr
        JOIN "ComissaoWr" cw ON cw."comissaoRegistroId" = cr."id"
       WHERE cw."regra" = 'SEM_CATEGORIA'
         AND cr."vendedorId" IS NOT NULL
       GROUP BY 1
    )
    SELECT v."id"                                          AS "vendedorId",
           COALESCE(cp.quantidade, 0)                      AS cotas_sem_categoria,
           COALESCE(lp.quantidade, 0)                      AS lancamentos,
           COALESCE(lp.valor, 0)                           AS valor,
           LEAST(cp.primeira, lp.primeira)                 AS primeira_venda,
           GREATEST(cp.ultima, lp.ultima)                  AS ultima_venda
      FROM "Vendedor" v
      LEFT JOIN cotas_pendentes cp       ON cp.vendedor_id = v."id"
      LEFT JOIN lancamentos_pendentes lp ON lp.vendedor_id = v."id"
     WHERE (cp.vendedor_id IS NOT NULL OR lp.vendedor_id IS NOT NULL)
       AND ${condicoes}
     ORDER BY COALESCE(lp.valor, 0) DESC, COALESCE(cp.quantidade, 0) DESC
     LIMIT 500
  `;

  if (linhas.length === 0) {
    return {
      itens: [],
      totalVendedores: 0,
      totalLancamentos: 0,
      totalCotas: 0,
      valorTotalBloqueado: 0,
    };
  }

  const ids = linhas.map((linha) => linha.vendedorId);

  const [vendedores, comHistorico] = await Promise.all([
    prisma.vendedor.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        observacoes: true,
        equipeId: true,
        gerenciaId: true,
        pessoaId: true,
        equipe: { select: { nome: true } },
        gerencia: { select: { nome: true } },
      },
    }),
    // O histórico é da pessoa: um documento novo herda a categoria dela.
    prisma.vendedorCategoriaHistorico.groupBy({
      by: ["pessoaId"],
      where: { pessoa: { documentos: { some: { id: { in: ids } } } } },
    }),
  ]);

  const porId = new Map(vendedores.map((vendedor) => [vendedor.id, vendedor]));
  const pessoasComHistorico = new Set(
    comHistorico.map((item) => item.pessoaId).filter((id): id is string => Boolean(id)),
  );

  const itens: PendenciaCadastro[] = [];
  let totalLancamentos = 0;
  let totalCotas = 0;
  let valorTotalBloqueado = 0;

  for (const linha of linhas) {
    const vendedor = porId.get(linha.vendedorId);
    if (!vendedor) continue;

    const lancamentos = Number(linha.lancamentos);
    const cotas = Number(linha.cotas_sem_categoria);
    const valor = Math.round(Number(linha.valor ?? 0) * 100) / 100;

    totalLancamentos += lancamentos;
    totalCotas += cotas;
    valorTotalBloqueado += valor;

    itens.push({
      vendedorId: vendedor.id,
      nome: vendedor.nome,
      cpfCnpj: vendedor.cpfCnpj,
      criadoPelaImportacao: Boolean(
        vendedor.observacoes?.startsWith("Criado automaticamente pela importação"),
      ),
      temHistoricoCategoria: vendedor.pessoaId
        ? pessoasComHistorico.has(vendedor.pessoaId)
        : false,
      equipeId: vendedor.equipeId,
      gerenciaId: vendedor.gerenciaId,
      equipeNome: vendedor.equipe?.nome ?? null,
      gerenciaNome: vendedor.gerencia?.nome ?? null,
      cotasSemCategoria: cotas,
      lancamentosBloqueados: lancamentos,
      valorBloqueado: valor,
      primeiraVenda: linha.primeira_venda,
      ultimaVenda: linha.ultima_venda,
    });
  }

  return {
    itens,
    totalVendedores: itens.length,
    totalLancamentos,
    totalCotas,
    valorTotalBloqueado: Math.round(valorTotalBloqueado * 100) / 100,
  };
}

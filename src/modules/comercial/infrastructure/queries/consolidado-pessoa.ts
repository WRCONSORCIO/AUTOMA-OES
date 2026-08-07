import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Categoria } from "../../domain/rules/documentos";

/**
 * Consolidado da pessoa — a soma de todos os documentos dela.
 *
 * É o número que dispara promoção, então não pode ser aproximado nem
 * recalculado de forma diferente em cada tela.
 *
 * A agregação é feita em SQL, com uma CTE por dimensão. Juntar carteira,
 * estornos e comissões num único `JOIN` multiplicaria linhas — uma cota com
 * três comissões seria contada três vezes no volume vendido, e o erro cresceria
 * silenciosamente com o tamanho da base. Cada CTE agrega isoladamente e só
 * depois os totais se encontram.
 */

export interface ConsolidadoPessoa {
  pessoaId: string;
  nome: string;

  documentos: number;
  documentosCnpj: number;
  /** Maior categoria entre os documentos. É a categoria "de carreira". */
  categoriaAtual: Categoria | null;

  cotas: number;
  clientes: number;
  /** Volume vendido da carteira completa. Base da promoção. */
  volumeVendido: number;
  /** Parte do volume que já foi cancelada, para leitura de qualidade. */
  volumeCancelado: number;

  estornos: number;
  valorEstornado: number;

  /** O que a WR tem a pagar / já liberou pelas vendas de iniciante. */
  comissaoPrevista: number;
  comissaoLiberada: number;
  /** O que a administradora pagou direto — veterano e expert. */
  recebidoDaAdministradora: number;
}

interface LinhaBruta {
  pessoaId: string;
  nome: string;
  documentos: bigint;
  documentosCnpj: bigint;
  nivelCategoria: number | null;
  cotas: bigint;
  clientes: bigint;
  volumeVendido: Prisma.Decimal;
  volumeCancelado: Prisma.Decimal;
  estornos: bigint;
  valorEstornado: Prisma.Decimal;
  comissaoPrevista: Prisma.Decimal;
  comissaoLiberada: Prisma.Decimal;
  recebidoAdm: Prisma.Decimal;
}

const CATEGORIA_POR_NIVEL: Record<number, Categoria> = {
  1: "INICIANTE",
  2: "VETERANO",
  3: "EXPERT",
};

function numero(valor: Prisma.Decimal | null): number {
  return valor ? Number(valor) : 0;
}

/**
 * Consolidado de todas as pessoas, ou de uma só quando `pessoaId` é informado.
 *
 * `filtroGerencia` e `filtroEquipe` aplicam o escopo do usuário: gerente enxerga
 * a própria gerência, supervisor a própria equipe. O escopo é aplicado no
 * documento, que é onde a alocação vive.
 */
export async function consolidarPessoas(opcoes: {
  pessoaId?: string;
  gerenciaId?: string;
  equipeId?: string;
  limite?: number;
  busca?: string;
} = {}): Promise<ConsolidadoPessoa[]> {
  const { pessoaId, gerenciaId, equipeId, limite = 500, busca } = opcoes;

  const filtroDoc = Prisma.sql`
    ${pessoaId ? Prisma.sql`AND v."pessoaId" = ${pessoaId}` : Prisma.empty}
    ${gerenciaId ? Prisma.sql`AND v."gerenciaId" = ${gerenciaId}` : Prisma.empty}
    ${equipeId ? Prisma.sql`AND v."equipeId" = ${equipeId}` : Prisma.empty}
  `;

  const filtroBusca = busca
    ? Prisma.sql`AND (p.nome ILIKE ${`%${busca}%`} OR EXISTS (
        SELECT 1 FROM "Vendedor" vb
        WHERE vb."pessoaId" = p.id AND vb."cpfCnpj" LIKE ${`%${busca.replace(/\D/g, "")}%`}
      ))`
    : Prisma.empty;

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    WITH doc AS (
      SELECT v."pessoaId" AS pid, v.id AS vid, v."tipoDocumento" AS tipo,
             v."categoriaAtual" AS categoria
      FROM "Vendedor" v
      WHERE v."pessoaId" IS NOT NULL ${filtroDoc}
    ),
    documentos AS (
      SELECT pid,
             COUNT(*)                                        AS documentos,
             COUNT(*) FILTER (WHERE tipo = 'CNPJ')           AS cnpjs,
             MAX(CASE categoria
                   WHEN 'INICIANTE' THEN 1
                   WHEN 'VETERANO'  THEN 2
                   WHEN 'EXPERT'    THEN 3
                 END)                                        AS nivel
      FROM doc GROUP BY pid
    ),
    carteira AS (
      SELECT d.pid,
             COUNT(*)                                        AS cotas,
             COUNT(DISTINCT c."cpfCnpjCliente")              AS clientes,
             COALESCE(SUM(c."valorCredito"), 0)              AS volume,
             COALESCE(SUM(c."valorCredito")
                      FILTER (WHERE c.situacao = 'CANCELADO'), 0) AS cancelado
      FROM doc d
      JOIN "Cota" c ON c."vendedorEfetivoId" = d.vid
      GROUP BY d.pid
    ),
    estornos AS (
      SELECT d.pid,
             COUNT(*)                                        AS qtd,
             COALESCE(SUM(e."valorEstorno"), 0)              AS valor
      FROM doc d
      JOIN "Cota" c    ON c."vendedorEfetivoId" = d.vid
      JOIN "Estorno" e ON e."cotaId" = c.id
      GROUP BY d.pid
    ),
    comissoes AS (
      SELECT ce."pessoaId" AS pid,
             COALESCE(SUM(ce."valorPrevisto"), 0)            AS previsto,
             COALESCE(SUM(ce."valorLiberado"), 0)            AS liberado
      FROM "ComissaoEquipe" ce
      WHERE ce."pessoaId" IS NOT NULL AND ce.papel = 'VENDEDOR'
      GROUP BY ce."pessoaId"
    ),
    recebido AS (
      SELECT cva."pessoaId" AS pid,
             COALESCE(SUM(cva."valorComissao"
                          + COALESCE(cva."valorDsr", 0)
                          + COALESCE(cva."valorSeguro", 0)), 0) AS valor
      FROM "ComissaoVendedorAdm" cva
      WHERE cva."pessoaId" IS NOT NULL
      GROUP BY cva."pessoaId"
    )
    SELECT
      p.id                                  AS "pessoaId",
      p.nome                                AS "nome",
      COALESCE(dc.documentos, 0)            AS "documentos",
      COALESCE(dc.cnpjs, 0)                 AS "documentosCnpj",
      dc.nivel                              AS "nivelCategoria",
      COALESCE(ca.cotas, 0)                 AS "cotas",
      COALESCE(ca.clientes, 0)              AS "clientes",
      COALESCE(ca.volume, 0)                AS "volumeVendido",
      COALESCE(ca.cancelado, 0)             AS "volumeCancelado",
      COALESCE(es.qtd, 0)                   AS "estornos",
      COALESCE(es.valor, 0)                 AS "valorEstornado",
      COALESCE(co.previsto, 0)              AS "comissaoPrevista",
      COALESCE(co.liberado, 0)              AS "comissaoLiberada",
      COALESCE(re.valor, 0)                 AS "recebidoAdm"
    FROM "Pessoa" p
    JOIN documentos dc ON dc.pid = p.id
    LEFT JOIN carteira  ca ON ca.pid = p.id
    LEFT JOIN estornos  es ON es.pid = p.id
    LEFT JOIN comissoes co ON co.pid = p.id
    LEFT JOIN recebido  re ON re.pid = p.id
    WHERE TRUE ${filtroBusca}
    ORDER BY COALESCE(ca.volume, 0) DESC, p.nome ASC
    LIMIT ${limite}
  `;

  return linhas.map((linha) => ({
    pessoaId: linha.pessoaId,
    nome: linha.nome,
    documentos: Number(linha.documentos),
    documentosCnpj: Number(linha.documentosCnpj),
    categoriaAtual:
      linha.nivelCategoria === null
        ? null
        : (CATEGORIA_POR_NIVEL[linha.nivelCategoria] ?? null),
    cotas: Number(linha.cotas),
    clientes: Number(linha.clientes),
    volumeVendido: numero(linha.volumeVendido),
    volumeCancelado: numero(linha.volumeCancelado),
    estornos: Number(linha.estornos),
    valorEstornado: numero(linha.valorEstornado),
    comissaoPrevista: numero(linha.comissaoPrevista),
    comissaoLiberada: numero(linha.comissaoLiberada),
    recebidoDaAdministradora: numero(linha.recebidoAdm),
  }));
}

export async function consolidarPessoa(
  pessoaId: string,
): Promise<ConsolidadoPessoa | null> {
  const [consolidado] = await consolidarPessoas({ pessoaId, limite: 1 });
  return consolidado ?? null;
}

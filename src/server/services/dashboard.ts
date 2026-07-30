import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EscopoDados } from "@/server/auth/rbac";

export interface FiltroPeriodo {
  de?: Date;
  ate?: Date;
  administradoraId?: string;
  gerenciaId?: string;
  equipeId?: string;
  vendedorId?: string;
}

export interface IndicadoresDashboard {
  cotasAtivas: number;
  cotasCanceladas: number;
  cotasContempladas: number;
  cotasTotal: number;
  creditoTotal: number;
  vendasEmRecuperacao: number;
  estornos: number;
  valorRecebido: number;
  valorEstornado: number;
  comissaoWr: number;
  quantidadeParcelas: number;
  lancamentos: number;
}

export interface ItemRanking {
  id: string;
  nome: string;
  valor: number;
  comissaoWr: number;
  quantidade: number;
}

export interface PontoMensal {
  mes: string;
  valor: number;
  comissaoWr: number;
  quantidade: number;
}

function filtroComissao(filtro: FiltroPeriodo, escopo: EscopoDados): Prisma.ComissaoRegistroWhereInput {
  const where: Prisma.ComissaoRegistroWhereInput = {};

  if (filtro.de || filtro.ate) {
    where.dataReferencia = {};
    if (filtro.de) where.dataReferencia.gte = filtro.de;
    if (filtro.ate) where.dataReferencia.lte = filtro.ate;
  }

  if (filtro.administradoraId) where.administradoraId = filtro.administradoraId;
  if (filtro.vendedorId) where.vendedorId = filtro.vendedorId;

  // O escopo do usuário sempre prevalece sobre o filtro escolhido na tela.
  where.gerenciaId = escopo.gerenciaId ?? filtro.gerenciaId;
  where.equipeId = escopo.equipeId ?? filtro.equipeId;

  if (where.gerenciaId === undefined) delete where.gerenciaId;
  if (where.equipeId === undefined) delete where.equipeId;

  return where;
}

function filtroCota(filtro: FiltroPeriodo, escopo: EscopoDados): Prisma.CotaWhereInput {
  const where: Prisma.CotaWhereInput = {};

  if (filtro.de || filtro.ate) {
    where.dataVenda = {};
    if (filtro.de) where.dataVenda.gte = filtro.de;
    if (filtro.ate) where.dataVenda.lte = filtro.ate;
  }

  if (filtro.administradoraId) where.administradoraId = filtro.administradoraId;
  if (filtro.vendedorId) where.vendedorEfetivoId = filtro.vendedorId;

  const gerenciaId = escopo.gerenciaId ?? filtro.gerenciaId;
  const equipeId = escopo.equipeId ?? filtro.equipeId;
  if (gerenciaId) where.gerenciaId = gerenciaId;
  if (equipeId) where.equipeId = equipeId;

  return where;
}

export async function carregarIndicadores(
  filtro: FiltroPeriodo,
  escopo: EscopoDados,
): Promise<IndicadoresDashboard> {
  const whereComissao = filtroComissao(filtro, escopo);
  const whereCota = filtroCota(filtro, escopo);

  const [
    porSituacao,
    agregadoCotas,
    emRecuperacao,
    estornos,
    recebido,
    estornado,
    comissaoWr,
    parcelas,
  ] = await Promise.all([
    prisma.cota.groupBy({
      by: ["situacao"],
      where: whereCota,
      _count: { _all: true },
    }),
    prisma.cota.aggregate({
      where: whereCota,
      _sum: { valorCredito: true },
      _count: { _all: true },
    }),
    prisma.cota.count({ where: { ...whereCota, emRecuperacao: true } }),
    prisma.cota.count({ where: { ...whereCota, geraEstorno: true } }),
    prisma.comissaoRegistro.aggregate({
      where: { ...whereComissao, status: "NORMAL" },
      _sum: { valorComissao: true },
      _count: { _all: true },
    }),
    prisma.comissaoRegistro.aggregate({
      where: { ...whereComissao, status: "ESTORNO" },
      _sum: { valorComissao: true },
    }),
    prisma.comissaoWr.aggregate({
      where: { comissaoRegistro: whereComissao },
      _sum: { valor: true },
    }),
    prisma.comissaoRegistro.count({ where: whereComissao }),
  ]);

  const contarSituacao = (situacao: string) =>
    porSituacao.find((item) => item.situacao === situacao)?._count._all ?? 0;

  return {
    cotasAtivas: contarSituacao("ATIVO"),
    cotasCanceladas: contarSituacao("CANCELADO"),
    cotasContempladas: contarSituacao("CONTEMPLADO"),
    cotasTotal: agregadoCotas._count._all,
    creditoTotal: numero(agregadoCotas._sum.valorCredito),
    vendasEmRecuperacao: emRecuperacao,
    estornos,
    valorRecebido: numero(recebido._sum.valorComissao),
    valorEstornado: numero(estornado._sum.valorComissao),
    comissaoWr: numero(comissaoWr._sum.valor),
    quantidadeParcelas: parcelas,
    lancamentos: recebido._count._all,
  };
}

export async function carregarSerieMensal(
  filtro: FiltroPeriodo,
  escopo: EscopoDados,
): Promise<PontoMensal[]> {
  const where = filtroComissao(filtro, escopo);
  const condicoes = montarCondicoesSql(where);

  const linhas = await prisma.$queryRaw<
    { mes: string; valor: Prisma.Decimal | null; comissao_wr: Prisma.Decimal | null; quantidade: bigint }[]
  >`
    SELECT to_char(cr."dataReferencia", 'YYYY-MM') AS mes,
           SUM(cr."valorComissao")                 AS valor,
           SUM(COALESCE(cw."valor", 0))            AS comissao_wr,
           COUNT(*)                                AS quantidade
      FROM "ComissaoRegistro" cr
      LEFT JOIN "ComissaoWr" cw ON cw."comissaoRegistroId" = cr."id"
     WHERE ${condicoes}
     GROUP BY 1
     ORDER BY 1 ASC
  `;

  return linhas.map((linha) => ({
    mes: linha.mes,
    valor: numero(linha.valor),
    comissaoWr: numero(linha.comissao_wr),
    quantidade: Number(linha.quantidade),
  }));
}

/**
 * Monta o predicado SQL a partir do mesmo filtro usado nas consultas Prisma,
 * garantindo que o escopo do usuário seja aplicado também nas agregações brutas.
 */
function montarCondicoesSql(where: Prisma.ComissaoRegistroWhereInput): Prisma.Sql {
  const partes: Prisma.Sql[] = [Prisma.sql`TRUE`];

  const periodo = where.dataReferencia as { gte?: Date; lte?: Date } | undefined;
  if (periodo?.gte) partes.push(Prisma.sql`cr."dataReferencia" >= ${periodo.gte}`);
  if (periodo?.lte) partes.push(Prisma.sql`cr."dataReferencia" <= ${periodo.lte}`);
  if (typeof where.administradoraId === "string") {
    partes.push(Prisma.sql`cr."administradoraId" = ${where.administradoraId}`);
  }
  if (typeof where.gerenciaId === "string") {
    partes.push(Prisma.sql`cr."gerenciaId" = ${where.gerenciaId}`);
  }
  if (typeof where.equipeId === "string") {
    partes.push(Prisma.sql`cr."equipeId" = ${where.equipeId}`);
  }
  if (typeof where.vendedorId === "string") {
    partes.push(Prisma.sql`cr."vendedorId" = ${where.vendedorId}`);
  }

  return Prisma.join(partes, " AND ");
}

type Dimensao = "vendedorId" | "equipeId" | "gerenciaId" | "administradoraId" | "pessoaId";

export async function carregarRanking(
  dimensao: Dimensao,
  filtro: FiltroPeriodo,
  escopo: EscopoDados,
  limite = 10,
): Promise<ItemRanking[]> {
  const condicoes = montarCondicoesSql(filtroComissao(filtro, escopo));

  // A pessoa agrupa os documentos do mesmo vendedor (CPF e CNPJs), então o
  // ranking por pessoa soma tudo numa linha só.
  const chave =
    dimensao === "pessoaId"
      ? Prisma.sql`v."pessoaId"`
      : Prisma.sql`cr.${Prisma.raw(`"${dimensao}"`)}`;

  const juncaoVendedor =
    dimensao === "pessoaId"
      ? Prisma.sql`JOIN "Vendedor" v ON v."id" = cr."vendedorId"`
      : Prisma.empty;

  const linhas = await prisma.$queryRaw<
    { id: string; valor: Prisma.Decimal | null; comissao_wr: Prisma.Decimal | null; quantidade: bigint }[]
  >`
    SELECT ${chave}                      AS id,
           SUM(cr."valorComissao")       AS valor,
           SUM(COALESCE(cw."valor", 0))  AS comissao_wr,
           COUNT(*)                      AS quantidade
      FROM "ComissaoRegistro" cr
      ${juncaoVendedor}
      LEFT JOIN "ComissaoWr" cw ON cw."comissaoRegistroId" = cr."id"
     WHERE ${condicoes} AND ${chave} IS NOT NULL
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT ${limite}
  `;

  if (linhas.length === 0) return [];

  const nomes = await carregarNomes(
    dimensao,
    linhas.map((linha) => linha.id),
  );

  return linhas.map((linha) => ({
    id: linha.id,
    nome: nomes.get(linha.id) ?? "Não identificado",
    valor: numero(linha.valor),
    comissaoWr: numero(linha.comissao_wr),
    quantidade: Number(linha.quantidade),
  }));
}

async function carregarNomes(dimensao: Dimensao, ids: string[]): Promise<Map<string, string>> {
  const where = { id: { in: ids } };
  const selecao = { id: true, nome: true };

  const registros =
    dimensao === "pessoaId"
      ? await prisma.pessoa.findMany({ where, select: selecao })
      : dimensao === "vendedorId"
      ? await prisma.vendedor.findMany({ where, select: selecao })
      : dimensao === "equipeId"
        ? await prisma.equipe.findMany({ where, select: selecao })
        : dimensao === "gerenciaId"
          ? await prisma.gerencia.findMany({ where, select: selecao })
          : await prisma.administradora.findMany({ where, select: selecao });

  return new Map(registros.map((registro) => [registro.id, registro.nome]));
}

function numero(valor: Prisma.Decimal | number | null | undefined): number {
  if (valor === null || valor === undefined) return 0;
  return Math.round(Number(valor) * 100) / 100;
}

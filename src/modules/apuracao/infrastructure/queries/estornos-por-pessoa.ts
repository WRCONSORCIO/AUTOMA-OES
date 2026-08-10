import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Quanto há a estornar de cada pessoa, separado por motivo.
 *
 * A separação por tipo não é enfeite de relatório: são duas cobranças de
 * naturezas diferentes, negociadas com percentuais próprios, e o vendedor que
 * recebe a conta pergunta primeiro "de onde veio isso". Um total único
 * obrigaria a abrir venda por venda para responder.
 *
 * Agrega por PESSOA, somando os documentos dela — quem deve é a pessoa, não o
 * login. Agregar por documento faria a mesma pessoa aparecer duas vezes com
 * metade da conta em cada linha.
 *
 * Em SQL porque `groupBy` do Prisma não agrupa por campo de relação, e trazer
 * cada estorno para somar em memória custaria uma varredura da base a cada
 * abertura da tela.
 */

export interface FiltroEstornos {
  de?: Date;
  ate?: Date;
  pessoaId?: string;
  equipeId?: string;
  gerenciaId?: string;
}

export interface EstornoDaPessoa {
  pessoaId: string | null;
  pessoaNome: string;
  qtdRecuperacao: number;
  valorRecuperacao: number;
  qtdCancelamento: number;
  valorCancelamento: number;
  qtdTotal: number;
  valorTotal: number;
}

interface LinhaBruta {
  pessoa_id: string | null;
  pessoa_nome: string | null;
  qtd_recuperacao: bigint;
  valor_recuperacao: Prisma.Decimal;
  qtd_cancelamento: bigint;
  valor_cancelamento: Prisma.Decimal;
  qtd_total: bigint;
  valor_total: Prisma.Decimal;
}

export async function estornosPorPessoa(
  filtro: FiltroEstornos = {},
): Promise<EstornoDaPessoa[]> {
  const condicoes: Prisma.Sql[] = [];

  // A data que importa é a do CANCELAMENTO, não a da venda: é quando a
  // cobrança nasce, e é por ela que o financeiro fecha o mês.
  if (filtro.de) condicoes.push(Prisma.sql`e."dataCancelamento" >= ${filtro.de}`);
  if (filtro.ate) condicoes.push(Prisma.sql`e."dataCancelamento" <= ${filtro.ate}`);
  if (filtro.pessoaId) condicoes.push(Prisma.sql`v."pessoaId" = ${filtro.pessoaId}`);
  if (filtro.equipeId) condicoes.push(Prisma.sql`c."equipeId" = ${filtro.equipeId}`);
  if (filtro.gerenciaId) condicoes.push(Prisma.sql`c."gerenciaId" = ${filtro.gerenciaId}`);

  const onde =
    condicoes.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}`
      : Prisma.empty;

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT
      v."pessoaId" AS pessoa_id,
      p."nome"     AS pessoa_nome,
      COUNT(*) FILTER (WHERE e."tipo" = 'RECUPERACAO')  AS qtd_recuperacao,
      COALESCE(SUM(e."valorEstorno") FILTER (WHERE e."tipo" = 'RECUPERACAO'), 0)  AS valor_recuperacao,
      COUNT(*) FILTER (WHERE e."tipo" = 'CANCELAMENTO') AS qtd_cancelamento,
      COALESCE(SUM(e."valorEstorno") FILTER (WHERE e."tipo" = 'CANCELAMENTO'), 0) AS valor_cancelamento,
      COUNT(*) AS qtd_total,
      COALESCE(SUM(e."valorEstorno"), 0) AS valor_total
    FROM "Estorno" e
    JOIN "Cota" c ON c."id" = e."cotaId"
    LEFT JOIN "Vendedor" v ON v."id" = c."vendedorEfetivoId"
    LEFT JOIN "Pessoa"   p ON p."id" = v."pessoaId"
    ${onde}
    GROUP BY v."pessoaId", p."nome"
    ORDER BY valor_total DESC
  `;

  return linhas.map((linha) => ({
    pessoaId: linha.pessoa_id,
    // Venda cujo vendedor a administradora não identificou ainda gera estorno,
    // e some da tela se não tiver um rótulo. Aparecer sem dono é o que faz
    // alguém ir atrás do vínculo.
    pessoaNome: linha.pessoa_nome ?? "Vendedor não identificado",
    qtdRecuperacao: Number(linha.qtd_recuperacao),
    valorRecuperacao: Number(linha.valor_recuperacao),
    qtdCancelamento: Number(linha.qtd_cancelamento),
    valorCancelamento: Number(linha.valor_cancelamento),
    qtdTotal: Number(linha.qtd_total),
    valorTotal: Number(linha.valor_total),
  }));
}

export interface TotaisEstorno {
  recuperacao: number;
  cancelamento: number;
  total: number;
  vendas: number;
  pessoas: number;
}

export function totalizarEstornos(linhas: readonly EstornoDaPessoa[]): TotaisEstorno {
  return {
    recuperacao: arredondar(linhas.reduce((s, l) => s + l.valorRecuperacao, 0)),
    cancelamento: arredondar(linhas.reduce((s, l) => s + l.valorCancelamento, 0)),
    total: arredondar(linhas.reduce((s, l) => s + l.valorTotal, 0)),
    vendas: linhas.reduce((s, l) => s + l.qtdTotal, 0),
    pessoas: linhas.length,
  };
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

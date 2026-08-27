import "server-only";
import { prisma } from "@/lib/prisma";
import type { RegraEstornoVigente } from "../../domain/rules/estorno";

/**
 * Acesso às regras de estorno.
 *
 * Fica separado da regra pura de propósito: `domain/rules/estorno.ts` decide, e
 * este arquivo apenas busca. É o que permite testar a decisão sem banco.
 */

/**
 * Regras aplicáveis a um vendedor: as dele e as padrão da WR.
 *
 * Traz as duas de uma vez porque a precedência é decidida no domínio, não numa
 * consulta com `ORDER BY` — a regra de precedência é conhecimento de negócio e
 * pertence a onde está testada.
 */
export async function regrasDoVendedor(
  vendedorId: string | null,
): Promise<RegraEstornoVigente[]> {
  const linhas = await prisma.regraEstorno.findMany({
    where: vendedorId
      ? { OR: [{ vendedorId }, { vendedorId: null }] }
      : { vendedorId: null },
    select: {
      id: true,
      vendedorId: true,
      tipo: true,
      categoriasVenda: true,
      parcelaLimite: true,
      percentual: true,
      vigenteDe: true,
      vigenteAte: true,
    },
  });

  return linhas.map((linha) => ({
    ...linha,
    percentual: Number(linha.percentual),
  }));
}

/**
 * Comissão efetivamente paga sobre a cota — a base do estorno.
 *
 * Estorno é devolução de comissão, então a referência é o que foi PAGO, nunca
 * o valor do crédito. Um crédito de R$ 500.000 não gera estorno de R$ 500.000;
 * gera estorno da comissão que saiu por causa dele.
 *
 * Duas origens, conforme quem pagou:
 *
 * - Iniciante: a WR liberou pela `ComissaoEquipe` (papel VENDEDOR).
 * - Veterano e Expert: a administradora pagou direto (`ComissaoVendedorAdm`).
 *
 * Usa `valorLiberado` e não `valorPrevisto`: não se devolve o que nunca saiu.
 */
export async function comissaoPagaNaCota(cotaId: string): Promise<number> {
  const [daEquipe, daAdministradora] = await Promise.all([
    prisma.comissaoEquipe.aggregate({
      where: { cotaId, papel: "VENDEDOR" },
      _sum: { valorLiberado: true },
    }),
    prisma.comissaoVendedorAdm.aggregate({
      where: { cotaId },
      _sum: { valorComissao: true, valorDsr: true, valorSeguro: true },
    }),
  ]);

  const wr = Number(daEquipe._sum.valorLiberado ?? 0);
  const adm =
    Number(daAdministradora._sum.valorComissao ?? 0) +
    Number(daAdministradora._sum.valorDsr ?? 0) +
    Number(daAdministradora._sum.valorSeguro ?? 0);

  return wr + adm;
}

/** O débito de cancelamento que a administradora lançou contra a WR. */
export interface LancamentoDeCancelamento {
  readonly comissaoRegistroId: string;
  /** Data do lançamento no relatório — a competência da cobrança. */
  readonly dataLancamento: Date;
  /** O que a administradora tirou da WR nessa linha, sempre positivo. */
  readonly valorDebitado: number;
}

/**
 * O lançamento de CANCELAMENTO DE PLANO da cota, se a administradora já o fez.
 *
 * O cancelamento tem duas datas, e elas não coincidem. A base de clientes diz
 * quando o cliente saiu; o relatório de comissão diz quando a administradora
 * cobrou a WR de volta — e pode levar meses. Quem manda na cobrança é o
 * relatório: enquanto o débito não aparece nele, a WR não perdeu nada e não há
 * o que cobrar do vendedor.
 *
 * Havendo mais de um lançamento para a mesma cota — reapresentação, ajuste —
 * vale o mais ANTIGO: é ele que marca o mês em que o dinheiro saiu.
 */
export async function lancamentosDeCancelamento(
  cotaIds: readonly string[],
): Promise<Map<string, LancamentoDeCancelamento>> {
  const mapa = new Map<string, LancamentoDeCancelamento>();
  if (cotaIds.length === 0) return mapa;

  const linhas = await prisma.comissaoRegistro.findMany({
    where: { cotaId: { in: [...cotaIds] }, tipo: "CANCELAMENTO_DE_PLANO" },
    select: { id: true, cotaId: true, dataReferencia: true, valorComissao: true },
    orderBy: { dataReferencia: "asc" },
  });

  for (const linha of linhas) {
    if (!linha.cotaId || mapa.has(linha.cotaId)) continue;
    mapa.set(linha.cotaId, {
      comissaoRegistroId: linha.id,
      dataLancamento: linha.dataReferencia,
      // Chega negativo no relatório, porque é devolução. O sinal já disse o
      // que precisava dizer; o valor em si é uma grandeza.
      valorDebitado: Math.abs(Number(linha.valorComissao ?? 0)),
    });
  }

  return mapa;
}

/** Cotas que já têm débito de cancelamento lançado pela administradora. */
export async function cotasComCancelamentoLancado(): Promise<string[]> {
  const linhas = await prisma.comissaoRegistro.findMany({
    where: { tipo: "CANCELAMENTO_DE_PLANO", cotaId: { not: null } },
    select: { cotaId: true },
    distinct: ["cotaId"],
  });

  return linhas.map((linha) => linha.cotaId!).filter(Boolean);
}

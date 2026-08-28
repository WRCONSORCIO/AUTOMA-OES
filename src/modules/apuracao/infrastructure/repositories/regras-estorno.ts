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
 * De onde saiu o valor sobre o qual o estorno é calculado.
 *
 * Existir mais de uma origem não é frouxidão: é que o mesmo fato — "quanto o
 * vendedor recebeu por esta venda" — está gravado em lugares diferentes
 * conforme quem pagou, e nem sempre o lugar certo foi importado.
 */
export type OrigemDaBase =
  /** A WR liberou pela ComissaoEquipe. É o caso do iniciante. */
  | "COMISSAO_WR"
  /** A administradora pagou direto ao vendedor (relatório CV069E). */
  | "COMISSAO_ADMINISTRADORA"
  /**
   * O valor que a administradora tirou de volta no CANCELAMENTO DE PLANO.
   *
   * Usado quando não há registro do pagamento. É o segundo melhor número, e
   * costuma ser o único disponível: a comissão daquela venda foi paga em
   * meses cujo relatório talvez nunca tenha sido importado, mas o débito do
   * cancelamento está sempre lá — é ele que faz o estorno existir.
   */
  | "DEBITO_DO_CANCELAMENTO"
  | "SEM_BASE";

export interface BaseDoEstorno {
  valor: number;
  origem: OrigemDaBase;
}

/**
 * A base do estorno de cada cota, em quatro consultas para o lote inteiro.
 *
 * Estorno é devolução de comissão, então a referência é o que foi PAGO, nunca
 * o valor do crédito: um crédito de R$ 500.000 não gera estorno de R$ 500.000,
 * gera estorno da comissão que saiu por causa dele.
 *
 * A ordem das fontes é a ordem da confiança:
 *
 *   1. o que foi registrado como pago — o conceito exato da regra;
 *   2. faltando isso, o que a administradora tirou de volta no cancelamento.
 *
 * O segundo caminho existe porque o primeiro depende de ter importado o
 * relatório do mês em que a comissão foi paga, que pode ser de dois anos
 * atrás. Sem ele, todo estorno de venda antiga sairia zerado — com a regra
 * certa, a venda certa e nenhum erro em lugar nenhum. Era exatamente o que
 * acontecia.
 */
export async function basesDoEstorno(
  cotaIds: readonly string[],
): Promise<Map<string, BaseDoEstorno>> {
  const mapa = new Map<string, BaseDoEstorno>();
  if (cotaIds.length === 0) return mapa;

  const ids = [...cotaIds];

  const [daEquipe, daAdministradora, debitos] = await Promise.all([
    prisma.comissaoEquipe.groupBy({
      by: ["cotaId"],
      where: { cotaId: { in: ids }, papel: "VENDEDOR" },
      _sum: { valorLiberado: true },
    }),
    // Só as linhas POSITIVAS: o relatório traz o pagamento e, quando a venda
    // cai, a devolução como valor negativo. Somar as duas daria perto de zero
    // justamente na cota que precisa de base.
    prisma.comissaoVendedorAdm.groupBy({
      by: ["cotaId"],
      where: { cotaId: { in: ids }, valorComissao: { gt: 0 } },
      _sum: { valorComissao: true, valorDsr: true, valorSeguro: true },
    }),
    prisma.comissaoRegistro.groupBy({
      by: ["cotaId"],
      where: { cotaId: { in: ids }, tipo: "CANCELAMENTO_DE_PLANO" },
      _sum: { valorComissao: true },
    }),
  ]);

  const pago = new Map<string, number>();

  for (const linha of daEquipe) {
    pago.set(linha.cotaId, Number(linha._sum.valorLiberado ?? 0));
  }

  for (const linha of daAdministradora) {
    if (!linha.cotaId) continue;
    const adm =
      Number(linha._sum.valorComissao ?? 0) +
      Number(linha._sum.valorDsr ?? 0) +
      Number(linha._sum.valorSeguro ?? 0);
    mapa.set(linha.cotaId, { valor: 0, origem: "COMISSAO_ADMINISTRADORA" });
    pago.set(linha.cotaId, (pago.get(linha.cotaId) ?? 0) + adm);
  }

  for (const id of ids) {
    const valorPago = arredondar(pago.get(id) ?? 0);

    if (valorPago > 0) {
      mapa.set(id, {
        valor: valorPago,
        origem: mapa.get(id)?.origem === "COMISSAO_ADMINISTRADORA"
          ? "COMISSAO_ADMINISTRADORA"
          : "COMISSAO_WR",
      });
      continue;
    }

    mapa.set(id, { valor: 0, origem: "SEM_BASE" });
  }

  for (const linha of debitos) {
    if (!linha.cotaId) continue;
    if (mapa.get(linha.cotaId)?.origem !== "SEM_BASE") continue;

    // O débito chega negativo, porque é devolução. O sinal já disse o que
    // precisava dizer; a base é uma grandeza.
    const debitado = arredondar(Math.abs(Number(linha._sum.valorComissao ?? 0)));
    if (debitado <= 0) continue;

    mapa.set(linha.cotaId, { valor: debitado, origem: "DEBITO_DO_CANCELAMENTO" });
  }

  return mapa;
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
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

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
      categoriaVenda: true,
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

"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { formatarNumero } from "@/lib/format";
import { reapurarBonus } from "@/server/services/bonus";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

/**
 * Religa o bônus já importado às cotas e ao organograma de hoje.
 *
 * Necessária porque a atribuição é gravada no momento da importação e nunca
 * mais revista. Se o relatório entrou antes da base, ou se o vendedor ganhou
 * gerência depois, o valor ficou sem dono — e reimportar não resolve, porque a
 * linha já está gravada e a importação a trata como duplicada.
 */
export async function acaoReapurarBonus(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("comissoes", "editar");

  try {
    const resumo = await reapurarBonus({ id: sessao.id, nome: sessao.nome });

    revalidatePath("/bonus");

    if (resumo.avaliados === 0) {
      return { sucesso: "Não há bônus importado para reapurar." };
    }

    if (resumo.atribuicoesAtualizadas === 0) {
      const detalhe =
        resumo.semCota > 0
          ? ` ${formatarNumero(resumo.semCota)} continuam sem cota correspondente na base.`
          : "";
      return {
        sucesso:
          `${formatarNumero(resumo.avaliados)} lançamento(s) avaliados, nada mudou.${detalhe}`,
      };
    }

    const partes = [
      `${formatarNumero(resumo.atribuicoesAtualizadas)} lançamento(s) tiveram a gerência atualizada`,
    ];
    if (resumo.cotasVinculadas > 0) {
      partes.push(`${formatarNumero(resumo.cotasVinculadas)} passaram a ter cota vinculada`);
    }
    if (resumo.semCota > 0) {
      partes.push(`${formatarNumero(resumo.semCota)} seguem sem cota na base`);
    }
    if (resumo.semGerencia > 0) {
      partes.push(
        `${formatarNumero(resumo.semGerencia)} têm cota, mas a cota ainda não tem gerência — ` +
          `apure as comissões para preencher a alocação das vendas`,
      );
    }

    return { sucesso: `${partes.join(", ")}.` };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao reapurar o bônus." };
  }
}

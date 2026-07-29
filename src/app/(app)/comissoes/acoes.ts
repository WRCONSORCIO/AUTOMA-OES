"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { recalcularComissoes } from "@/server/services/recalculo";
import { formatarMoeda, formatarNumero } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

export async function acaoRecalcular(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("comissoes", "editar");

  try {
    const resumo = await recalcularComissoes({ id: sessao.id, nome: sessao.nome });

    revalidatePath("/comissoes");
    revalidatePath("/");

    return {
      sucesso:
        `Recálculo concluído: ${formatarNumero(resumo.cotasComCategoriaPreenchida)} venda(s) tiveram a categoria preenchida e ` +
        `${formatarNumero(resumo.lancamentosAtualizados)} lançamento(s) foram atualizados, somando ${formatarMoeda(resumo.valorComissaoWr)} de comissão WR.`,
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao recalcular." };
  }
}

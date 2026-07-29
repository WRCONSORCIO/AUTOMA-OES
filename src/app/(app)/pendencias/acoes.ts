"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { parseDataBr } from "@/lib/normalize";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { alterarAlocacao, alterarCategoria } from "@/server/services/vendedores";
import { recalcularComissoes } from "@/server/services/recalculo";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const CATEGORIAS = ["INICIANTE", "VETERANO", "EXPERT"] as const;

/**
 * Resolve a pendência de um vendedor: registra a categoria com a data de início
 * informada e, opcionalmente, ajusta equipe e gerência. O recálculo é disparado
 * em seguida para liberar as comissões que estavam travadas.
 */
export async function acaoResolverPendencia(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");
  const usuario = { id: sessao.id, nome: sessao.nome };

  const vendedorId = String(formData.get("vendedorId") ?? "");
  const categoria = String(formData.get("categoria") ?? "") as (typeof CATEGORIAS)[number];
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));
  const equipeId = String(formData.get("equipeId") ?? "") || null;
  const gerenciaId = String(formData.get("gerenciaId") ?? "") || null;

  if (!vendedorId) return { erro: "Vendedor não informado." };
  if (!CATEGORIAS.includes(categoria)) return { erro: "Selecione a categoria." };
  if (!vigenteDe) {
    return { erro: "Informe a data de início da categoria — ela define quais vendas serão liberadas." };
  }

  try {
    await alterarCategoria(
      vendedorId,
      categoria,
      vigenteDe,
      "Cadastro completado pela tela de pendências",
      usuario,
    );

    if (equipeId || gerenciaId) {
      await alterarAlocacao(
        vendedorId,
        equipeId,
        gerenciaId,
        vigenteDe,
        "Alocação definida pela tela de pendências",
        usuario,
      );
    }

    const resumo = await recalcularComissoes(usuario);

    revalidatePath("/pendencias");
    revalidatePath("/comissoes");
    revalidatePath("/");

    return {
      sucesso:
        `Categoria registrada. ${formatarNumero(resumo.cotasComCategoriaPreenchida)} venda(s) tiveram a categoria preenchida e ` +
        `${formatarNumero(resumo.lancamentosAtualizados)} lançamento(s) foram recalculados (${formatarMoeda(resumo.valorComissaoWr)} de comissão WR).`,
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao resolver a pendência." };
  }
}

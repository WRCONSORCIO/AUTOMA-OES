"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { apurarComissoesEquipe } from "@/server/services/comissao-equipe";
import { formatarMoeda, formatarNumero } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

/**
 * Reapura a comissão da equipe sobre tudo que já foi importado.
 *
 * É o botão usado depois de cadastrar ou corrigir uma tabela: as importações já
 * apuram sozinhas, mas quem cadastra a tabela depois precisa de um gatilho.
 */
export async function acaoApurar(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("comissoesEquipe", "editar");

  try {
    const resumo = await apurarComissoesEquipe({
      usuario: { id: sessao.id, nome: sessao.nome },
    });

    revalidatePath("/comissoes-equipe");

    if (resumo.cotasComTabela === 0) {
      return {
        erro:
          `Nenhuma das ${formatarNumero(resumo.cotasAvaliadas)} venda(s) tem tabela vigente para ` +
          "a sua categoria. Cadastre a tabela em Tabelas e Flex e apure novamente.",
      };
    }

    return {
      sucesso:
        `Apuração concluída sobre ${formatarNumero(resumo.cotasComTabela)} venda(s): ` +
        `${formatarMoeda(resumo.valorPrevisto)} previstos, ${formatarMoeda(resumo.valorLiberado)} já liberados` +
        (resumo.cotasSemTabela > 0
          ? `. ${formatarNumero(resumo.cotasSemTabela)} venda(s) ficaram de fora por não haver tabela vigente para a categoria.`
          : "."),
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao apurar." };
  }
}

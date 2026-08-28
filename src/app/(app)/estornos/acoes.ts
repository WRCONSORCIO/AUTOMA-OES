"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { apurarEstornos } from "@/modules/apuracao/application/reavaliar-estorno";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

/**
 * Reaplica as regras de estorno sobre as vendas canceladas.
 *
 * Necessário porque o estorno nasce de evento, no momento da importação: se a
 * regra não estava cadastrada naquele instante, nenhuma cobrança foi criada e
 * nada volta a olhar sozinho. Cadastrar a regra depois não produz efeito até
 * alguém apurar.
 *
 * A cobrança só existe onde a administradora já lançou o CANCELAMENTO DE PLANO
 * no relatório de comissão da WR. As demais canceladas aparecem no resumo como
 * "aguardando lançamento" — não são erro, é o débito que ainda não chegou.
 */
export async function acaoApurarEstornos(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("comissoesEquipe", "editar");

  try {
    const resumo = await apurarEstornos({ id: sessao.id, nome: sessao.nome });

    revalidatePath("/estornos");
    revalidatePath("/clientes");

    const religou =
      resumo.religacao.religadas > 0
        ? `${formatarNumero(resumo.religacao.religadas)} linha(s) de comissão paga ao vendedor ` +
          `voltaram a apontar para a venda. `
        : "";

    if (resumo.canceladasAvaliadas === 0) {
      return { sucesso: `${religou}Não há vendas canceladas para avaliar.` };
    }

    if (resumo.criados === 0 && resumo.atualizados === 0 && resumo.removidos === 0) {
      const partes: string[] = [];
      if (resumo.semEstorno.semRegra > 0) {
        partes.push(
          `${formatarNumero(resumo.semEstorno.semRegra)} sem regra vigente na data do cancelamento`,
        );
      }
      if (resumo.semEstorno.acimaDoLimiteDeParcelas > 0) {
        partes.push(
          `${formatarNumero(resumo.semEstorno.acimaDoLimiteDeParcelas)} com parcelas pagas acima do limite da regra`,
        );
      }
      if (resumo.semEstorno.aguardandoLancamento > 0) {
        partes.push(
          `${formatarNumero(resumo.semEstorno.aguardandoLancamento)} aguardando o CANCELAMENTO DE PLANO no relatório da administradora`,
        );
      }
      if (resumo.inalterados > 0) {
        partes.push(`${formatarNumero(resumo.inalterados)} já estavam corretos`);
      }

      return {
        sucesso:
          religou +
          `${formatarNumero(resumo.canceladasAvaliadas)} venda(s) cancelada(s) avaliadas, nada mudou` +
          (partes.length > 0 ? `: ${partes.join(", ")}.` : "."),
      };
    }

    return {
      sucesso:
        religou +
        `${formatarNumero(resumo.canceladasAvaliadas)} venda(s) cancelada(s) avaliadas: ` +
        `${formatarNumero(resumo.criados)} estorno(s) criado(s), ` +
        `${formatarNumero(resumo.atualizados)} atualizado(s), ` +
        `${formatarNumero(resumo.removidos)} removido(s), ` +
        `${formatarNumero(resumo.semEstorno.aguardandoLancamento)} aguardando lançamento da administradora. ` +
        `Total a estornar: ${formatarMoeda(resumo.valorTotal)}.`,
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao apurar os estornos." };
  }
}

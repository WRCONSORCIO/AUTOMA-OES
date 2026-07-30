import type { CondicaoComissao, PapelComissao } from "@prisma/client";
import { arredondar2, calcularBaseComissao } from "./regras";

/**
 * Comissão que a WR paga à própria equipe sobre cada venda.
 *
 * Não confundir com o módulo Comissões WR, que registra o que a administradora
 * paga PARA a WR. Aqui é o caminho inverso: quanto a WR deve a cada vendedor,
 * supervisão e gerência.
 *
 * Nenhum percentual, nome de equipe ou condição vive no código — tudo vem da
 * tabela cadastrada para a categoria da venda.
 */

export interface RegraPapel {
  id: string;
  papel: PapelComissao;
  percentual: number;
  condicao: CondicaoComissao;
}

export interface ContextoVenda {
  /// Categoria vigente na data da venda, já fotografada na cota.
  valorCredito: number;
  percentualFlex: number | null;
  /// Unidade de supervisão da venda (a equipe do vendedor no momento da venda).
  equipeId: string | null;
  /// Unidade de gerência da venda.
  gerenciaId: string | null;
  /// A equipe está marcada para as regras condicionais.
  equipeHabilitada: boolean;
  /// A gerência é a mesma unidade que aparece como supervisão.
  supervisaoIgualGerencia: boolean;
}

export interface ComissaoApurada {
  papel: PapelComissao;
  percentual: number;
  baseCalculo: number;
  valor: number;
  regraId: string;
}

/** A condição decide se a linha da regra vale para esta venda. */
export function condicaoAtendida(
  condicao: CondicaoComissao,
  contexto: ContextoVenda,
): boolean {
  switch (condicao) {
    case "SEMPRE":
      return true;
    case "SUPERVISAO_DIFERENTE_GERENCIA":
      return !contexto.supervisaoIgualGerencia;
    case "EQUIPE_HABILITADA":
      return contexto.equipeHabilitada;
    default:
      return false;
  }
}

/**
 * Apura a comissão de cada papel para uma venda.
 *
 * A base é o crédito com a redução do flex — o mesmo "crédito de comissão" que
 * a WR usa hoje. Papéis sem regra cadastrada, com percentual zero ou com a
 * condição não atendida simplesmente não geram linha.
 */
export function apurarComissaoEquipe(
  regras: readonly RegraPapel[],
  contexto: ContextoVenda,
): ComissaoApurada[] {
  const baseCalculo = calcularBaseComissao(contexto.valorCredito, contexto.percentualFlex);
  const apuradas: ComissaoApurada[] = [];

  for (const regra of regras) {
    if (regra.percentual <= 0) continue;
    if (!condicaoAtendida(regra.condicao, contexto)) continue;

    // Sem unidade definida não há a quem pagar supervisão ou gerência.
    if (regra.papel === "SUPERVISOR" && !contexto.equipeId) continue;
    if (regra.papel === "GERENCIA" && !contexto.gerenciaId) continue;

    apuradas.push({
      papel: regra.papel,
      percentual: regra.percentual,
      baseCalculo,
      valor: arredondar2((baseCalculo * regra.percentual) / 100),
      regraId: regra.id,
    });
  }

  return apuradas;
}

/**
 * Parcela da comissão prevista já liberada pelos recebimentos.
 *
 * A WR recebe da administradora ao longo das parcelas, então a comissão da
 * equipe é liberada na mesma medida. Com `parcelasParaLiberacao` igual a 1, o
 * primeiro recebimento libera tudo.
 */
export function calcularLiberado(
  valorPrevisto: number,
  parcelasRecebidas: number,
  parcelasParaLiberacao: number,
): number {
  if (parcelasRecebidas <= 0) return 0;

  const divisor = Math.max(1, parcelasParaLiberacao);
  const proporcao = Math.min(1, parcelasRecebidas / divisor);
  return arredondar2(valorPrevisto * proporcao);
}

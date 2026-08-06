import { arredondar, percentual } from "@/shared/domain/dinheiro";
import { resolverVigentePorPrecedencia } from "@/shared/domain/periodo";
import type { ComVigencia } from "@/shared/domain/periodo";

/**
 * Regra de estorno — parametrizada.
 *
 * Substitui a constante `PARCELA_LIMITE_ESTORNO = 6`, que era regra de negócio
 * escrita em código: mudar o limite exigia deploy, e mudá-lo reescrevia
 * retroativamente o julgamento de cancelamentos antigos.
 *
 * O briefing define **dois tipos** de estorno e exige percentual configurável
 * por vendedor. Aqui a regra vem de fora, resolvida pela data do fato.
 *
 * Módulo puro: nenhum acesso a banco. Toda a decisão é testável isoladamente.
 */

export type TipoEstorno = "CANCELAMENTO" | "RECUPERACAO";

export interface RegraEstornoVigente extends ComVigencia {
  readonly id: string;
  /** Nulo = regra padrão da WR, aplicada a quem não tem regra própria. */
  readonly vendedorId: string | null;
  readonly tipo: TipoEstorno;
  /**
   * Cancelamento com parcelas pagas ABAIXO deste número gera estorno.
   * Zero desliga o estorno para o caso — é como se configura "este vendedor
   * não estorna" sem precisar de uma flag separada.
   */
  readonly parcelaLimite: number;
  /** Percentual do valor de referência a estornar, em pontos (100 = integral). */
  readonly percentual: number;
}

export interface FatoCancelamento {
  readonly vendedorId: string | null;
  /** Marcação permanente de venda realizada durante recuperação. */
  readonly emRecuperacao: boolean;
  readonly parcelasPagas: number;
  readonly dataCancelamento: Date | null;
  /** Comissão já paga sobre a venda — é o que se devolve. */
  readonly valorReferencia: number | null;
}

export type DecisaoEstorno =
  | { readonly gera: false; readonly motivo: string }
  | {
      readonly gera: true;
      readonly tipo: TipoEstorno;
      readonly regraId: string;
      readonly parcelaLimite: number;
      readonly percentualAplicado: number;
      readonly valorEstorno: number;
      readonly motivo: string;
    };

/**
 * Qual dos dois tipos se aplica.
 *
 * A marcação de recuperação é permanente e vale sobre a data da VENDA, não a do
 * cancelamento — uma venda feita em recuperação continua sendo de recuperação
 * mesmo que cancele anos depois, já com o período encerrado.
 */
export function tipoDoEstorno(fato: FatoCancelamento): TipoEstorno {
  return fato.emRecuperacao ? "RECUPERACAO" : "CANCELAMENTO";
}

/**
 * Escolhe a regra que vale para o vendedor na data do cancelamento.
 *
 * Precedência: regra **do vendedor** vence a regra **padrão**. Entre duas do
 * mesmo nível, vence a de vigência mais recente. Nunca há fallback para
 * constante: sem regra cadastrada, não há estorno — e o motivo aparece na
 * decisão, para o financeiro saber que falta configurar em vez de achar que a
 * venda simplesmente não estornava.
 */
export function resolverRegra(
  regras: readonly RegraEstornoVigente[],
  tipo: TipoEstorno,
  vendedorId: string | null,
  data: Date,
): RegraEstornoVigente | null {
  const candidatas = regras.filter(
    (regra) =>
      regra.tipo === tipo &&
      (regra.vendedorId === null || regra.vendedorId === vendedorId),
  );

  return resolverVigentePorPrecedencia(
    candidatas,
    data,
    (regra) => regra.vendedorId !== null,
  );
}

/**
 * Decide se o cancelamento gera estorno e quanto.
 *
 * Devolve sempre um motivo legível — inclusive quando NÃO gera. Estorno é
 * dinheiro tirado de alguém; "não gerou porque X" precisa ser tão auditável
 * quanto "gerou por Y".
 */
export function avaliarEstorno(
  fato: FatoCancelamento,
  regras: readonly RegraEstornoVigente[],
): DecisaoEstorno {
  if (!fato.dataCancelamento) {
    return { gera: false, motivo: "Cota não está cancelada." };
  }

  const tipo = tipoDoEstorno(fato);
  const regra = resolverRegra(regras, tipo, fato.vendedorId, fato.dataCancelamento);

  if (!regra) {
    return {
      gera: false,
      motivo: `Sem regra de estorno vigente do tipo ${tipo} na data do cancelamento.`,
    };
  }

  if (fato.parcelasPagas >= regra.parcelaLimite) {
    return {
      gera: false,
      motivo: `${fato.parcelasPagas} parcela(s) paga(s) — a regra estorna apenas abaixo de ${regra.parcelaLimite}.`,
    };
  }

  const referencia = fato.valorReferencia ?? 0;
  const valorEstorno = arredondar(Math.abs(percentual(referencia, regra.percentual)));

  return {
    gera: true,
    tipo,
    regraId: regra.id,
    parcelaLimite: regra.parcelaLimite,
    percentualAplicado: regra.percentual,
    valorEstorno,
    motivo:
      `Cancelamento com ${fato.parcelasPagas} parcela(s) paga(s), abaixo do limite de ` +
      `${regra.parcelaLimite}. Estorno de ${regra.percentual}% sobre ${referencia.toFixed(2)}.`,
  };
}

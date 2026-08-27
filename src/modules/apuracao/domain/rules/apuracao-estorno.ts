/**
 * Os desfechos possíveis de uma sincronização de estorno, e como eles viram o
 * resumo que aparece na tela.
 *
 * Módulo puro de propósito. A contagem é o que o usuário lê para decidir se
 * precisa cadastrar uma regra, esperar a administradora ou não fazer nada —
 * e distinguir esses três casos é justamente o que estava faltando quando a
 * tela dizia só "canceladas sem estorno".
 */

export type DesfechoEstorno =
  | "CRIADO"
  | "ATUALIZADO"
  | "INALTERADO"
  | "REMOVIDO"
  /** Cancelada na base, mas a administradora ainda não debitou a WR. */
  | "AGUARDANDO_LANCAMENTO"
  | "SEM_REGRA"
  | "ACIMA_DO_LIMITE"
  | "SEM_CANCELAMENTO";

export interface ResultadoSincronizacao {
  cotaId: string;
  desfecho: DesfechoEstorno;
  /** Valor após a sincronização. Zero quando não há estorno. */
  valorEstorno: number;
  /** Valor que existia antes — para medir o que a operação liberou. */
  valorAnterior: number;
  /** Regra manda cobrar, mas não há comissão paga que sirva de base. */
  semComissaoPaga: boolean;
  motivo: string;
}

export interface ResumoApuracaoEstornos {
  canceladasAvaliadas: number;
  criados: number;
  atualizados: number;
  removidos: number;
  inalterados: number;
  valorTotal: number;
  /** Por que uma venda cancelada não gerou cobrança. */
  semEstorno: {
    semRegra: number;
    acimaDoLimiteDeParcelas: number;
    semComissaoPaga: number;
    /**
     * Cancelada na base de clientes, mas a administradora ainda não lançou o
     * CANCELAMENTO DE PLANO. Não é falta de cadastro: é o débito que ainda não
     * chegou, e sem ele a WR não perdeu nada para cobrar de volta.
     */
    aguardandoLancamento: number;
  };
}

export function resumirApuracao(
  resultados: readonly ResultadoSincronizacao[],
): ResumoApuracaoEstornos {
  const resumo: ResumoApuracaoEstornos = {
    canceladasAvaliadas: 0,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    inalterados: 0,
    valorTotal: 0,
    semEstorno: {
      semRegra: 0,
      acimaDoLimiteDeParcelas: 0,
      semComissaoPaga: 0,
      aguardandoLancamento: 0,
    },
  };

  for (const resultado of resultados) {
    // Venda ativa e sem débito não é "venda avaliada": ela só entrou no
    // conjunto para o caso de haver estorno velho a desfazer.
    if (resultado.desfecho !== "SEM_CANCELAMENTO") resumo.canceladasAvaliadas += 1;

    switch (resultado.desfecho) {
      case "CRIADO":
        resumo.criados += 1;
        break;
      case "ATUALIZADO":
        resumo.atualizados += 1;
        break;
      case "INALTERADO":
        resumo.inalterados += 1;
        break;
      case "REMOVIDO":
        resumo.removidos += 1;
        break;
      case "SEM_REGRA":
        resumo.semEstorno.semRegra += 1;
        break;
      case "ACIMA_DO_LIMITE":
        resumo.semEstorno.acimaDoLimiteDeParcelas += 1;
        break;
      case "AGUARDANDO_LANCAMENTO":
        resumo.semEstorno.aguardandoLancamento += 1;
        break;
      default:
        break;
    }

    if (resultado.semComissaoPaga) resumo.semEstorno.semComissaoPaga += 1;
    resumo.valorTotal += resultado.valorEstorno;
  }

  resumo.valorTotal = Math.round(resumo.valorTotal * 100) / 100;
  return resumo;
}

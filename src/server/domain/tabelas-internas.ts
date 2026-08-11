import type { DestinoComissao, SegmentoVenda } from "@prisma/client";
import { arredondar2, calcularBaseComissao, inicioDoDiaUtc } from "./regras";

/**
 * Percentuais de comissão por destino, produto e parcela.
 *
 * As cinco tabelas funcionam do mesmo jeito: a cada parcela que a WR recebe da
 * administradora, procura-se o percentual daquela parcela na tabela do destino
 * e do segmento da venda. Parcela sem percentual cadastrado não gera nada — é
 * assim que "gerência só recebe na primeira parcela" fica configurado, sem
 * nenhuma exceção escrita em código.
 *
 * Iniciante, supervisão e gerência são o que a WR paga. Veterano e expert são o
 * que a administradora paga direto ao vendedor: a WR não desembolsa, mas
 * precisa do valor para calcular o estorno quando a venda cai.
 */

export interface FaixaInterna {
  parcela: number;
  percentual: number;
}

export interface TabelaInterna {
  id: string;
  destino: DestinoComissao;
  segmento: SegmentoVenda;
  vigenteDe: Date;
  vigenteAte: Date | null;
  faixas: FaixaInterna[];
}

export const ROTULO_DESTINO: Record<DestinoComissao, string> = {
  INICIANTE: "Iniciante",
  VETERANO: "Veterano",
  EXPERT: "Expert",
  SUPERVISOR: "Supervisão",
  GERENCIA: "Gerência",
};

export const ROTULO_SEGMENTO: Record<SegmentoVenda, string> = {
  IMOVEL: "Imóveis",
  AUTOMOVEL: "Móveis",
};

/** Iniciante, supervisão e gerência a WR paga. Veterano e expert só estorno. */
export const DESTINO_PAGO: Record<DestinoComissao, boolean> = {
  INICIANTE: true,
  VETERANO: false,
  EXPERT: false,
  SUPERVISOR: true,
  GERENCIA: true,
};

type CargaInicial = Record<
  DestinoComissao,
  Partial<Record<SegmentoVenda, [parcela: number, percentual: number][]>>
>;

/** Percentuais informados pela WR. Ponto de partida, não regra de código. */
export const CARGA_INICIAL: CargaInicial = {
  INICIANTE: {
    IMOVEL: [
      [1, 0.5],
      [2, 0.4],
      [3, 0.3],
      [4, 0.3],
    ],
    AUTOMOVEL: [
      [1, 0.4],
      [2, 0.4],
      [3, 0.4],
    ],
  },
  VETERANO: {
    IMOVEL: [
      [1, 0.8],
      [3, 0.4],
      [4, 0.4],
      [6, 0.4],
    ],
    AUTOMOVEL: [
      [1, 0.5],
      [3, 0.5],
      [5, 0.5],
    ],
  },
  EXPERT: {
    IMOVEL: [
      [1, 0.3],
      [3, 0.1],
      [4, 0.1],
    ],
    AUTOMOVEL: [
      [1, 0.3],
      [3, 0.2],
    ],
  },
  SUPERVISOR: {
    IMOVEL: [
      [1, 0.3],
      [3, 0.1],
      [4, 0.1],
    ],
    AUTOMOVEL: [
      [1, 0.3],
      [3, 0.2],
    ],
  },
  GERENCIA: {
    IMOVEL: [[1, 0.3]],
    AUTOMOVEL: [[1, 0.3]],
  },
};

/** Modalidades de flex de 10 em 10, como pedido. Editáveis depois. */
export const FLEX_INICIAL = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Destinos que a WR efetivamente paga. Os demais existem para o estorno. */
export const DESTINOS_PAGOS_PELA_WR: readonly DestinoComissao[] = [
  "INICIANTE",
  "SUPERVISOR",
  "GERENCIA",
];

/**
 * A WR paga alguém por esta venda?
 *
 * **Só venda de INICIANTE.** Não é só a supervisão e a gerência que ficam de
 * fora quando a venda é de veterano ou expert — o vendedor também. Nessas, a
 * administradora paga direto a ele, e a WR não desembolsa nada para ninguém.
 *
 * As tabelas de veterano e expert continuam existindo, e não é contradição:
 * elas dizem quanto ele recebeu da administradora, que é a base do estorno
 * quando a venda cai. Calcular não é pagar.
 *
 * Venda sem categoria congelada não remunera ninguém: sem saber sob qual
 * condição foi feita, pagar seria pagar por suposição.
 */
export function wrPagaComissaoDaVenda(
  categoriaVenda: string | null | undefined,
): boolean {
  return categoriaVenda === "INICIANTE";
}

/**
 * Supervisão e gerência só existem sobre venda de iniciante.
 *
 * Mesma condição de `wrPagaComissaoDaVenda`, com nome próprio porque o uso é
 * outro: na apuração da carteira o VENDEDOR é calculado em toda categoria —
 * é a base do estorno —, mas supervisão e gerência não, porque não há estorno
 * delas nem pagamento.
 */
export function remuneraSupervisaoEGerencia(
  categoriaVenda: string | null | undefined,
): boolean {
  return wrPagaComissaoDaVenda(categoriaVenda);
}

export function wrPaga(destino: DestinoComissao): boolean {
  return DESTINOS_PAGOS_PELA_WR.includes(destino);
}

function cobre(tabela: TabelaInterna, data: Date): boolean {
  const dia = inicioDoDiaUtc(data).getTime();
  if (inicioDoDiaUtc(tabela.vigenteDe).getTime() > dia) return false;
  if (!tabela.vigenteAte) return true;
  return inicioDoDiaUtc(tabela.vigenteAte).getTime() >= dia;
}

/** A tabela vigente na data da venda; havendo mais de uma, a mais recente. */
export function resolverTabelaInterna(
  tabelas: readonly TabelaInterna[],
  destino: DestinoComissao,
  segmento: SegmentoVenda | null,
  data: Date,
): TabelaInterna | null {
  if (!segmento) return null;

  return (
    tabelas
      .filter(
        (tabela) =>
          tabela.destino === destino && tabela.segmento === segmento && cobre(tabela, data),
      )
      .sort(
        (a, b) =>
          inicioDoDiaUtc(b.vigenteDe).getTime() - inicioDoDiaUtc(a.vigenteDe).getTime(),
      )[0] ?? null
  );
}

export interface ApuracaoDaVenda {
  /** Soma dos percentuais de todas as parcelas da tabela. */
  percentualTotal: number;
  baseCalculo: number;
  /** O que a venda vale por inteiro, quando todas as parcelas entrarem. */
  previsto: number;
  /** A parte já coberta pelas parcelas efetivamente recebidas. */
  liberado: number;
  /** Quantas parcelas da tabela têm percentual — informa a tela. */
  parcelasComPercentual: number;
}

/**
 * O que uma venda vale para um destino, do primeiro ao último recebimento.
 *
 * A comissão do consórcio não é um percentual único sobre o crédito: é um
 * percentual DIFERENTE a cada parcela recebida, e há parcelas que não pagam
 * nada. Somar as faixas dá o total da venda; somar só as faixas já recebidas
 * dá o que pode ser pago hoje.
 *
 * É por isso que `parcelasRecebidas` entra aqui e não numa regra de liberação
 * à parte: a liberação não é uma fração do total, é o subconjunto das parcelas
 * que de fato entraram.
 */
export function apurarVendaPorParcelas(entrada: {
  tabela: TabelaInterna | null;
  valorCredito: number;
  percentualFlex: number | null;
  parcelasRecebidas: number;
}): ApuracaoDaVenda {
  const baseCalculo = calcularBaseComissao(entrada.valorCredito, entrada.percentualFlex);
  const faixas = (entrada.tabela?.faixas ?? []).filter((faixa) => faixa.percentual > 0);

  const percentualTotal = faixas.reduce((soma, faixa) => soma + faixa.percentual, 0);
  const percentualLiberado = faixas
    .filter((faixa) => faixa.parcela <= entrada.parcelasRecebidas)
    .reduce((soma, faixa) => soma + faixa.percentual, 0);

  return {
    percentualTotal: arredondar4(percentualTotal),
    baseCalculo,
    previsto: arredondar2((baseCalculo * percentualTotal) / 100),
    liberado: arredondar2((baseCalculo * percentualLiberado) / 100),
    parcelasComPercentual: faixas.length,
  };
}

function arredondar4(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

export interface ResultadoComissaoInterna {
  aplicavel: boolean;
  baseCalculo: number;
  percentual: number;
  valor: number;
  regra: string;
  observacao?: string;
}

export interface EntradaComissaoInterna {
  destino: DestinoComissao;
  segmento: SegmentoVenda | null;
  parcela: number;
  valorCredito: number;
  percentualFlex: number | null;
  tabela: TabelaInterna | null;
}

/**
 * Quanto a comissão daquele destino vale na parcela informada.
 *
 * A base é o crédito com a redução do flex — o mesmo "crédito de comissão" que
 * a administradora usa. O percentual sai da parcela.
 */
export function calcularComissaoInterna(
  entrada: EntradaComissaoInterna,
): ResultadoComissaoInterna {
  const baseCalculo = calcularBaseComissao(entrada.valorCredito, entrada.percentualFlex);

  if (!entrada.segmento) {
    return {
      aplicavel: false,
      baseCalculo,
      percentual: 0,
      valor: 0,
      regra: "SEM_SEGMENTO",
      observacao: "Produto da venda não identificado como imóvel ou automóvel.",
    };
  }

  if (!entrada.tabela) {
    return {
      aplicavel: false,
      baseCalculo,
      percentual: 0,
      valor: 0,
      regra: "SEM_TABELA",
      observacao: `Não há tabela vigente de ${entrada.destino} para ${entrada.segmento}.`,
    };
  }

  const faixa = entrada.tabela.faixas.find((item) => item.parcela === entrada.parcela);

  if (!faixa || faixa.percentual <= 0) {
    return {
      aplicavel: false,
      baseCalculo,
      percentual: 0,
      valor: 0,
      regra: "PARCELA_SEM_PERCENTUAL",
      observacao: `A parcela ${entrada.parcela} não tem percentual cadastrado para ${entrada.destino}.`,
    };
  }

  return {
    aplicavel: true,
    baseCalculo,
    percentual: faixa.percentual,
    valor: arredondar2((baseCalculo * faixa.percentual) / 100),
    regra: "TABELA_INTERNA",
  };
}

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
 * Novato, supervisão e gerência são o que a WR paga. Veterano e expert são o
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
  NOVATO: "Novato",
  VETERANO: "Veterano",
  EXPERT: "Expert",
  SUPERVISOR: "Supervisão",
  GERENCIA: "Gerência",
};

export const ROTULO_SEGMENTO: Record<SegmentoVenda, string> = {
  IMOVEL: "Imóveis",
  AUTOMOVEL: "Móveis",
};

/** Novato, supervisão e gerência a WR paga. Veterano e expert são só estorno. */
export const DESTINO_PAGO: Record<DestinoComissao, boolean> = {
  NOVATO: true,
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
  NOVATO: {
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
  "NOVATO",
  "SUPERVISOR",
  "GERENCIA",
];

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

/**
 * Catálogo de eventos de domínio.
 *
 * Contrato único entre quem publica e quem consome. Um evento é um **fato
 * consumado** — por isso todo nome está no passado — e o payload carrega o
 * escopo exato do que mudou.
 *
 * O escopo é o que torna a apuração incremental possível: o handler recebe os
 * ids do que mudou e recalcula só aquilo. Handler que precisa varrer a base
 * inteira é sinal de que o payload está pobre demais.
 *
 * Módulo puro: só tipos, nenhuma dependência.
 */

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

interface EscopoCota {
  readonly cotaId: string;
  readonly administradoraId: string;
}

/** Campos alterados: `campo → [antes, depois]`. Alimenta auditoria e decide o que reapurar. */
export type Alteracoes = Readonly<Record<string, readonly [unknown, unknown]>>;

export interface CatalogoEventos {
  // --- Carteira ---------------------------------------------------------
  "carteira.cota.criada": EscopoCota & {
    readonly vendedorEfetivoId: string | null;
    readonly dataVenda: string | null;
    readonly valorCredito: number | null;
  };
  "carteira.cota.alterada": EscopoCota & {
    readonly alteracoes: Alteracoes;
  };
  "carteira.cota.cancelada": EscopoCota & {
    readonly vendedorEfetivoId: string | null;
    readonly dataCancelamento: string;
    readonly parcelasPagas: number;
    readonly emRecuperacao: boolean;
    /**
     * Categoria congelada na venda. Vai no evento, e não é buscada pelo
     * handler, porque é o snapshot da época — reler do vendedor traria a
     * categoria de hoje e estornaria pela regra errada.
     */
    readonly categoriaVenda: "INICIANTE" | "VETERANO" | "EXPERT" | null;
  };
  "carteira.cota.contemplada": EscopoCota & {
    readonly dataContemplacao: string | null;
  };
  "carteira.cota.parcela_paga": EscopoCota & {
    readonly parcela: number;
    readonly comissaoRegistroId: string;
  };
  "carteira.cota.vendedor_alterado": EscopoCota & {
    readonly vendedorAnteriorId: string | null;
    readonly vendedorNovoId: string;
    readonly motivo: string;
  };

  // --- Comercial --------------------------------------------------------
  "comercial.documento.vinculado": {
    readonly pessoaId: string;
    readonly vendedorId: string;
    readonly automatico: boolean;
  };
  "comercial.categoria.alterada": {
    readonly vendedorId: string;
    readonly pessoaId: string | null;
    readonly categoria: string;
    readonly vigenteDe: string;
  };
  "comercial.alocacao.alterada": {
    readonly vendedorId: string;
    readonly equipeId: string | null;
    readonly gerenciaId: string | null;
    readonly vigenteDe: string;
  };
  "comercial.recuperacao.iniciada": {
    readonly vendedorId: string | null;
    readonly pessoaId: string | null;
    readonly recuperacaoId: string;
    readonly dataInicio: string;
    readonly dataFim: string;
  };

  // --- Apuração ---------------------------------------------------------
  "apuracao.comissao.registrada": {
    readonly comissaoRegistroId: string;
    readonly cotaId: string | null;
    readonly vendedorId: string | null;
    readonly parcela: number;
  };
  /**
   * A administradora debitou a WR pelo cancelamento de um plano.
   *
   * É o fato que autoriza a cobrança do vendedor. Separado de
   * `carteira.cota.cancelada` porque são momentos distintos: o cliente sai na
   * base de clientes, e o dinheiro volta no relatório de comissão — às vezes
   * dois meses depois.
   */
  "apuracao.cancelamento.lancado": {
    readonly comissaoRegistroId: string;
    readonly cotaId: string;
    readonly vendedorId: string | null;
    /** Data do lançamento no relatório — a competência da cobrança. */
    readonly dataLancamento: string;
    /** O que a administradora tirou da WR, sempre positivo. */
    readonly valorDebitado: number;
  };
  "apuracao.estorno.gerado": {
    readonly estornoId: string;
    readonly cotaId: string;
    readonly vendedorId: string | null;
    readonly tipo: "CANCELAMENTO" | "RECUPERACAO";
    readonly valorEstorno: number;
  };
  "apuracao.bonus.rateado": {
    readonly bonusId: string;
    readonly gerenciaId: string | null;
    readonly valorIncentivo: number;
  };

  // --- Ingestão ---------------------------------------------------------
  "ingestao.importacao.concluida": {
    readonly importacaoId: string;
    readonly tipo: string;
    readonly totalLinhas: number;
    readonly qtdErros: number;
  };
  "ingestao.importacao.falhou": {
    readonly importacaoId: string;
    readonly tipo: string;
    readonly motivo: string;
  };
}

export type TipoEvento = keyof CatalogoEventos;

export type PayloadDe<T extends TipoEvento> = CatalogoEventos[T];

/** Todos os tipos do catálogo, para validação em runtime na borda. */
export const TIPOS_EVENTO = [
  "carteira.cota.criada",
  "carteira.cota.alterada",
  "carteira.cota.cancelada",
  "carteira.cota.contemplada",
  "carteira.cota.parcela_paga",
  "carteira.cota.vendedor_alterado",
  "comercial.documento.vinculado",
  "comercial.categoria.alterada",
  "comercial.alocacao.alterada",
  "comercial.recuperacao.iniciada",
  "apuracao.comissao.registrada",
  "apuracao.cancelamento.lancado",
  "apuracao.estorno.gerado",
  "apuracao.bonus.rateado",
  "ingestao.importacao.concluida",
  "ingestao.importacao.falhou",
] as const satisfies readonly TipoEvento[];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Rastro de origem. Responde "quem causou isso" em qualquer ponto da cadeia. */
export interface MetadadosEvento {
  readonly usuarioId?: string | null;
  readonly usuarioNome?: string | null;
  readonly ip?: string | null;
  readonly importacaoId?: string | null;
  /**
   * Id que atravessa toda a cadeia disparada por uma mesma ação. É o que
   * permite responder "esta importação gerou quais estornos" sem adivinhar por
   * janela de tempo.
   */
  readonly correlacaoId?: string | null;
}

/** Evento pronto para publicar, ainda sem id — quem persiste atribui. */
export interface NovoEvento<T extends TipoEvento = TipoEvento> {
  readonly tipo: T;
  readonly agregado: string;
  readonly agregadoId: string;
  readonly payload: PayloadDe<T>;
  readonly metadados?: MetadadosEvento;
  /** Quando o FATO ocorreu. Ausente = agora. */
  readonly ocorridoEm?: Date;
  readonly versao?: number;
}

/** Evento já persistido, como chega ao handler. */
export interface EventoPublicado<T extends TipoEvento = TipoEvento> {
  readonly id: string;
  readonly tipo: T;
  readonly versao: number;
  readonly agregado: string;
  readonly agregadoId: string;
  readonly payload: PayloadDe<T>;
  readonly metadados: MetadadosEvento;
  readonly ocorridoEm: Date;
}

/** Construtor tipado. Erra em compilação se o payload não bate com o tipo. */
export function evento<T extends TipoEvento>(
  tipo: T,
  agregado: string,
  agregadoId: string,
  payload: PayloadDe<T>,
  metadados?: MetadadosEvento,
  ocorridoEm?: Date,
): NovoEvento<T> {
  return { tipo, agregado, agregadoId, payload, metadados, ocorridoEm };
}

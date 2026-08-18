import type { ProvedorPagamento, StatusPagamento } from "@prisma/client";

/**
 * Contrato do gateway de pagamento.
 *
 * O atendimento nunca fala com a Stripe: fala com esta interface. Trocar de
 * gateway — porque outro aceita a atividade, porque a taxa é melhor — é
 * escrever outra implementação e mudar a configuração, sem tocar no fluxo do
 * WhatsApp.
 *
 * Valores trafegam em centavos, inteiros. Float em dinheiro é erro de
 * arredondamento esperando acontecer.
 */

export interface DadosCobranca {
  pedidoId: string;
  numeroPedido: number;
  descricao: string;
  /** Em centavos. */
  valorCentavos: number;
  moeda: string;
  clienteNome: string | null;
  clienteTelefone: string;
  /** Para onde o gateway devolve o cliente depois de pagar. */
  urlRetorno?: string;
  expiraEm?: Date;
}

export interface CobrancaCriada {
  /** Id da cobrança no gateway. */
  externoId: string;
  /** Link enviado ao cliente. Nulo quando o gateway não gera link. */
  link: string | null;
  status: StatusPagamento;
  expiraEm: Date | null;
  payload?: unknown;
}

export interface SituacaoCobranca {
  externoId: string;
  status: StatusPagamento;
  pagoEm: Date | null;
  payload?: unknown;
}

/** Evento de webhook já validado e traduzido para a linguagem do sistema. */
export interface EventoWebhookPagamento {
  /** Id do evento no gateway. É a chave da idempotência. */
  eventoId: string;
  tipo: string;
  /** Id da cobrança a que o evento se refere. */
  externoId: string | null;
  status: StatusPagamento | null;
  pagoEm: Date | null;
  /** Recorte do payload guardado para auditoria — nunca o objeto inteiro. */
  resumo: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly nome: ProvedorPagamento;
  /** `false` quando falta credencial: o fluxo avisa em vez de cobrar errado. */
  readonly configurado: boolean;

  createPayment(dados: DadosCobranca): Promise<CobrancaCriada>;
  getPayment(externoId: string): Promise<SituacaoCobranca | null>;
  cancelPayment(externoId: string): Promise<void>;
  refundPayment(externoId: string, valorCentavos?: number): Promise<void>;
  /**
   * Valida a assinatura do webhook e traduz o corpo.
   *
   * Devolve `null` quando a assinatura não confere — e aí o evento é
   * descartado. Nunca aceitar payload não assinado: é ele que libera serviço.
   */
  validateWebhook(corpoBruto: string, assinatura: string | null): Promise<EventoWebhookPagamento | null>;
  /** Diagnóstico exibido no painel ("Testar conexão"). */
  testarConexao(): Promise<{ ok: boolean; detalhe: string }>;
}

/** Converte `Decimal`/string do banco para centavos inteiros. */
export function paraCentavos(valor: { toString(): string }): number {
  const texto = Number(valor.toString()).toFixed(2);
  return Number(texto.replace(".", ""));
}

export function deCentavos(centavos: number): number {
  return centavos / 100;
}

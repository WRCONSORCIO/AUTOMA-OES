import type { ProvedorPagamento } from "@prisma/client";
import type {
  CobrancaCriada,
  DadosCobranca,
  EventoWebhookPagamento,
  PaymentProvider,
  SituacaoCobranca,
} from "./tipos";

/**
 * Gateway simulado, para desenvolvimento.
 *
 * Gera um link falso e mantém a cobrança pendente. A confirmação continua sendo
 * um ato externo — no ambiente de desenvolvimento, o botão "Confirmar pagamento
 * (simulado)" da tela do pedido, que percorre exatamente o mesmo caminho do
 * webhook real.
 *
 * O que ele **não** faz é confirmar sozinho. Um simulador que se autoconfirma
 * esconderia justamente o defeito mais caro: liberar serviço sem dinheiro.
 *
 * Nunca deve ser usado em produção; a tela de configuração diz isso.
 */
export class ProvedorSimulado implements PaymentProvider {
  readonly nome: ProvedorPagamento = "MANUAL";
  readonly configurado = true;

  constructor(private readonly appUrl?: string | null) {}

  async createPayment(dados: DadosCobranca): Promise<CobrancaCriada> {
    const externoId = `sim_${dados.pedidoId}`;
    const base = (this.appUrl ?? "http://localhost:3000").replace(/\/$/, "");

    return {
      externoId,
      link: `${base}/pagamento/simulado/${externoId}`,
      status: "PENDING",
      expiraEm: dados.expiraEm ?? null,
      payload: { simulado: true, numero_pedido: dados.numeroPedido },
    };
  }

  async getPayment(externoId: string): Promise<SituacaoCobranca | null> {
    return { externoId, status: "PENDING", pagoEm: null };
  }

  async cancelPayment(): Promise<void> {}

  async refundPayment(): Promise<void> {}

  async validateWebhook(): Promise<EventoWebhookPagamento | null> {
    return null;
  }

  async testarConexao(): Promise<{ ok: boolean; detalhe: string }> {
    return {
      ok: true,
      detalhe: "Modo simulação: cobranças são criadas localmente e nunca confirmadas sozinhas.",
    };
  }
}

import type { ProvedorPagamento } from "@prisma/client";
import type {
  CobrancaCriada,
  DadosCobranca,
  EventoWebhookPagamento,
  PaymentProvider,
  SituacaoCobranca,
} from "./tipos";

/**
 * Gateway ausente.
 *
 * Usado quando nenhuma credencial está configurada. Cria a cobrança no banco
 * como pendente e **não** gera link — o bot avisa o cliente que o pagamento
 * está indisponível em vez de fingir que cobrou.
 *
 * Nunca confirma pagamento sozinho: quem confirma é o gateway real, e sem
 * gateway não há confirmação. É o mesmo princípio do resto do módulo — "paguei"
 * escrito pelo cliente não move nada.
 */
export class ProvedorManual implements PaymentProvider {
  readonly nome: ProvedorPagamento = "MANUAL";
  readonly configurado = false;

  async createPayment(dados: DadosCobranca): Promise<CobrancaCriada> {
    return {
      externoId: `manual_${dados.pedidoId}`,
      link: null,
      status: "PENDING",
      expiraEm: dados.expiraEm ?? null,
    };
  }

  async getPayment(externoId: string): Promise<SituacaoCobranca | null> {
    return { externoId, status: "PENDING", pagoEm: null };
  }

  async cancelPayment(): Promise<void> {
    // Nada a cancelar fora do banco.
  }

  async refundPayment(): Promise<void> {
    throw new Error("Estorno exige um gateway configurado.");
  }

  async validateWebhook(): Promise<EventoWebhookPagamento | null> {
    return null;
  }

  async testarConexao(): Promise<{ ok: boolean; detalhe: string }> {
    return {
      ok: false,
      detalhe: "Nenhum gateway configurado. Cadastre as chaves em Atendimento → Configurações.",
    };
  }
}

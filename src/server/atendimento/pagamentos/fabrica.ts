import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { decifrar } from "../servicos/segredos";
import { ProvedorManual } from "./manual";
import { ProvedorSimulado } from "./simulador";
import { StripeProvider } from "./stripe";
import type { PaymentProvider } from "./tipos";

/**
 * Escolhe o gateway de pagamento.
 *
 * Ordem: configuração salva no painel, depois variáveis de ambiente, depois o
 * provedor manual — que não cobra nada e diz por quê. O resto do sistema chama
 * `obterProvedorPagamento()` e não sabe qual gateway respondeu.
 *
 * Trocar de gateway no futuro (Mercado Pago, Asaas, PagBank) é escrever a
 * classe e acrescentar um `case` aqui.
 */

export const CHAVE_CONFIG_PAGAMENTO = "atendimento.pagamento";

export interface ConfiguracaoPagamentoSalva {
  provedor?: "STRIPE" | "MANUAL";
  ambiente?: "TEST" | "LIVE";
  publishableKey?: string | null;
  secretKeyCifrada?: string | null;
  webhookSecretCifrado?: string | null;
}

export async function lerConfiguracaoPagamento(): Promise<ConfiguracaoPagamentoSalva | null> {
  const registro = await prisma.configuracaoSistema.findUnique({
    where: { chave: CHAVE_CONFIG_PAGAMENTO },
  });

  const valor = registro?.valor;
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;

  return valor as ConfiguracaoPagamentoSalva;
}

export async function obterProvedorPagamento(): Promise<PaymentProvider> {
  const ambiente = env();

  // Simulação é escolha explícita de ambiente e vence tudo: é o modo de
  // desenvolvimento, e não faria sentido a configuração salva mandar chamadas
  // reais para a Stripe a partir de uma máquina local.
  if (ambiente.PAYMENT_PROVIDER === "SIMULADOR") {
    return new ProvedorSimulado(ambiente.APP_URL ?? null);
  }

  const salva = await lerConfiguracaoPagamento();

  if (salva?.provedor === "STRIPE") {
    const secretKey = decifrar(salva.secretKeyCifrada);
    if (secretKey) {
      return new StripeProvider({
        secretKey,
        webhookSecret: decifrar(salva.webhookSecretCifrado),
        appUrl: ambiente.APP_URL ?? null,
      });
    }
  }

  if (ambiente.PAYMENT_PROVIDER !== "MANUAL" && ambiente.STRIPE_SECRET_KEY) {
    return new StripeProvider({
      secretKey: ambiente.STRIPE_SECRET_KEY,
      webhookSecret: ambiente.STRIPE_WEBHOOK_SECRET ?? null,
      appUrl: ambiente.APP_URL ?? null,
    });
  }

  return new ProvedorManual();
}

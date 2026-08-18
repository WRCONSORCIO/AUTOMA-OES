import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProvedorPagamento, StatusPagamento } from "@prisma/client";
import type {
  CobrancaCriada,
  DadosCobranca,
  EventoWebhookPagamento,
  PaymentProvider,
  SituacaoCobranca,
} from "./tipos";

/**
 * Integração com a Stripe via API REST oficial.
 *
 * Sem SDK: a superfície usada é pequena (criar sessão de checkout, consultar,
 * expirar, estornar) e a validação de assinatura do webhook é o esquema
 * documentado `t=...,v1=...`, implementado aqui com `node:crypto` e comparação
 * em tempo constante. Menos uma dependência para manter, e a parte crítica fica
 * coberta por teste que roda sem rede.
 *
 * Nada neste arquivo sabe o que é atendimento, plano ou conversa: ele fala
 * cobrança. É o que permite trocar de gateway sem mexer no fluxo.
 */

const BASE = "https://api.stripe.com/v1";

/** Tolerância do timestamp do webhook, como recomenda a documentação. */
const TOLERANCIA_SEGUNDOS = 300;

export interface ConfiguracaoStripe {
  secretKey: string;
  webhookSecret?: string | null;
  /** Base pública da aplicação, usada nas URLs de retorno. */
  appUrl?: string | null;
}

export class StripeProvider implements PaymentProvider {
  readonly nome: ProvedorPagamento = "STRIPE";
  readonly configurado = true;

  constructor(private readonly config: ConfiguracaoStripe) {}

  async createPayment(dados: DadosCobranca): Promise<CobrancaCriada> {
    const retorno = dados.urlRetorno ?? this.config.appUrl ?? "";

    const corpo: Record<string, string> = {
      mode: "payment",
      client_reference_id: dados.pedidoId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": dados.moeda.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(dados.valorCentavos),
      "line_items[0][price_data][product_data][name]": dados.descricao,
      "metadata[pedido_id]": dados.pedidoId,
      "metadata[numero_pedido]": String(dados.numeroPedido),
      "payment_intent_data[metadata][pedido_id]": dados.pedidoId,
    };

    if (retorno) {
      corpo.success_url = `${retorno.replace(/\/$/, "")}/pagamento/obrigado?pedido=${dados.numeroPedido}`;
      corpo.cancel_url = `${retorno.replace(/\/$/, "")}/pagamento/cancelado?pedido=${dados.numeroPedido}`;
    }

    if (dados.expiraEm) {
      corpo.expires_at = String(Math.floor(dados.expiraEm.getTime() / 1000));
    }

    // A chave de idempotência é o pedido: dois cliques no mesmo botão geram uma
    // cobrança só, e não duas para o cliente pagar em dobro.
    const sessao = await this.chamar<StripeSessao>("POST", "/checkout/sessions", corpo, {
      "Idempotency-Key": `pedido-${dados.pedidoId}`,
    });

    return {
      externoId: sessao.id,
      link: sessao.url ?? null,
      status: statusDaSessao(sessao),
      expiraEm: sessao.expires_at ? new Date(sessao.expires_at * 1000) : (dados.expiraEm ?? null),
      payload: resumoSessao(sessao),
    };
  }

  async getPayment(externoId: string): Promise<SituacaoCobranca | null> {
    try {
      const sessao = await this.chamar<StripeSessao>(
        "GET",
        `/checkout/sessions/${encodeURIComponent(externoId)}`,
      );

      return {
        externoId: sessao.id,
        status: statusDaSessao(sessao),
        pagoEm: sessao.payment_status === "paid" ? new Date() : null,
        payload: resumoSessao(sessao),
      };
    } catch {
      return null;
    }
  }

  async cancelPayment(externoId: string): Promise<void> {
    await this.chamar("POST", `/checkout/sessions/${encodeURIComponent(externoId)}/expire`);
  }

  async refundPayment(externoId: string, valorCentavos?: number): Promise<void> {
    const sessao = await this.chamar<StripeSessao>(
      "GET",
      `/checkout/sessions/${encodeURIComponent(externoId)}`,
    );

    const intencao = typeof sessao.payment_intent === "string" ? sessao.payment_intent : null;
    if (!intencao) throw new Error("Cobrança sem pagamento capturado para estornar.");

    const corpo: Record<string, string> = { payment_intent: intencao };
    if (valorCentavos) corpo.amount = String(valorCentavos);

    await this.chamar("POST", "/refunds", corpo);
  }

  async validateWebhook(
    corpoBruto: string,
    assinatura: string | null,
  ): Promise<EventoWebhookPagamento | null> {
    const segredo = this.config.webhookSecret;
    if (!segredo || !assinatura) return null;
    if (!assinaturaConfere(corpoBruto, assinatura, segredo)) return null;

    let evento: StripeEvento;
    try {
      evento = JSON.parse(corpoBruto) as StripeEvento;
    } catch {
      return null;
    }

    if (!evento?.id || !evento.type) return null;

    return traduzirEvento(evento);
  }

  async testarConexao(): Promise<{ ok: boolean; detalhe: string }> {
    try {
      const conta = await this.chamar<{ id: string; livemode?: boolean }>("GET", "/account");
      return {
        ok: true,
        detalhe: `Conectado à conta ${conta.id} (${conta.livemode ? "live" : "test"}).`,
      };
    } catch (erro) {
      return { ok: false, detalhe: erro instanceof Error ? erro.message : "Falha desconhecida" };
    }
  }

  private async chamar<T>(
    metodo: "GET" | "POST",
    caminho: string,
    corpo?: Record<string, string>,
    cabecalhosExtras: Record<string, string> = {},
  ): Promise<T> {
    const resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...cabecalhosExtras,
      },
      body: corpo ? new URLSearchParams(corpo).toString() : undefined,
    });

    const texto = await resposta.text();

    if (!resposta.ok) {
      // A mensagem da Stripe é útil e não contém segredo; a chave nunca entra
      // no erro registrado.
      const detalhe = extrairMensagemDeErro(texto) ?? `HTTP ${resposta.status}`;
      throw new Error(`Stripe: ${detalhe}`);
    }

    return JSON.parse(texto) as T;
  }
}

// ---------------------------------------------------------------------------
// Assinatura do webhook
// ---------------------------------------------------------------------------

/**
 * Confere o cabeçalho `Stripe-Signature`.
 *
 * Formato: `t=1710000000,v1=abc...,v1=def...`. O conteúdo assinado é
 * `${t}.${corpo}` com HMAC-SHA256 e o segredo do endpoint. Podem vir várias
 * assinaturas `v1` durante a rotação do segredo: basta uma conferir.
 *
 * O timestamp também é verificado — sem isso, um payload legítimo capturado
 * poderia ser reenviado para sempre.
 */
export function assinaturaConfere(
  corpoBruto: string,
  cabecalho: string,
  segredo: string,
  agora: Date = new Date(),
  toleranciaSegundos: number = TOLERANCIA_SEGUNDOS,
): boolean {
  const partes = cabecalho.split(",").map((parte) => parte.trim());

  const timestamp = partes
    .find((parte) => parte.startsWith("t="))
    ?.slice(2);
  const assinaturas = partes
    .filter((parte) => parte.startsWith("v1="))
    .map((parte) => parte.slice(3));

  if (!timestamp || assinaturas.length === 0) return false;

  const emSegundos = Number(timestamp);
  if (!Number.isFinite(emSegundos)) return false;

  const diferenca = Math.abs(Math.floor(agora.getTime() / 1000) - emSegundos);
  if (diferenca > toleranciaSegundos) return false;

  const esperada = createHmac("sha256", segredo)
    .update(`${timestamp}.${corpoBruto}`, "utf8")
    .digest("hex");

  return assinaturas.some((assinatura) => comparacaoSegura(assinatura, esperada));
}

function comparacaoSegura(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

// ---------------------------------------------------------------------------
// Tradução dos eventos
// ---------------------------------------------------------------------------

interface StripeSessao {
  id: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string | null;
  expires_at?: number | null;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

interface StripeEvento {
  id: string;
  type: string;
  created?: number;
  data?: { object?: Record<string, unknown> };
}

function statusDaSessao(sessao: StripeSessao): StatusPagamento {
  if (sessao.payment_status === "paid" || sessao.payment_status === "no_payment_required") {
    return "PAID";
  }
  if (sessao.status === "expired") return "EXPIRED";
  if (sessao.status === "complete") return "PROCESSING";
  return "PENDING";
}

/**
 * Traduz o evento da Stripe para a linguagem do sistema.
 *
 * Evento desconhecido vira um registro sem status — o webhook o guarda como
 * `IGNORADO` em vez de deixar passar como se fosse pagamento.
 */
export function traduzirEvento(evento: StripeEvento): EventoWebhookPagamento {
  const objeto = (evento.data?.object ?? {}) as Record<string, unknown>;

  const sessaoId = typeof objeto.id === "string" ? objeto.id : null;
  const intencao = typeof objeto.payment_intent === "string" ? objeto.payment_intent : null;
  const statusPagamento = typeof objeto.payment_status === "string" ? objeto.payment_status : null;

  const resumo: Record<string, unknown> = {
    id: sessaoId,
    payment_intent: intencao,
    payment_status: statusPagamento,
    status: typeof objeto.status === "string" ? objeto.status : null,
    amount_total: typeof objeto.amount_total === "number" ? objeto.amount_total : null,
    currency: typeof objeto.currency === "string" ? objeto.currency : null,
    client_reference_id:
      typeof objeto.client_reference_id === "string" ? objeto.client_reference_id : null,
    metadata: objeto.metadata ?? null,
  };

  const quando = evento.created ? new Date(evento.created * 1000) : new Date();

  switch (evento.type) {
    case "checkout.session.completed":
      return {
        eventoId: evento.id,
        tipo: evento.type,
        externoId: sessaoId,
        // Pagamento assíncrono (boleto, pix em alguns fluxos) completa a sessão
        // sem ter sido pago ainda. Marcar PAID aqui liberaria serviço sem
        // dinheiro: fica PROCESSING até o evento de sucesso.
        status: statusPagamento === "paid" ? "PAID" : "PROCESSING",
        pagoEm: statusPagamento === "paid" ? quando : null,
        resumo,
      };

    case "checkout.session.async_payment_succeeded":
      return {
        eventoId: evento.id,
        tipo: evento.type,
        externoId: sessaoId,
        status: "PAID",
        pagoEm: quando,
        resumo,
      };

    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return {
        eventoId: evento.id,
        tipo: evento.type,
        externoId: sessaoId ?? intencao,
        status: "FAILED",
        pagoEm: null,
        resumo,
      };

    case "checkout.session.expired":
      return {
        eventoId: evento.id,
        tipo: evento.type,
        externoId: sessaoId,
        status: "EXPIRED",
        pagoEm: null,
        resumo,
      };

    case "charge.refunded":
    case "refund.created":
      return {
        eventoId: evento.id,
        tipo: evento.type,
        // No estorno o objeto é a cobrança, não a sessão: a ligação com o
        // pedido é feita pela intenção de pagamento guardada no pagamento.
        externoId: intencao,
        status: "REFUNDED",
        pagoEm: null,
        resumo,
      };

    default:
      return {
        eventoId: evento.id,
        tipo: evento.type,
        externoId: sessaoId,
        status: null,
        pagoEm: null,
        resumo,
      };
  }
}

function resumoSessao(sessao: StripeSessao): Record<string, unknown> {
  return {
    id: sessao.id,
    status: sessao.status ?? null,
    payment_status: sessao.payment_status ?? null,
    payment_intent: sessao.payment_intent ?? null,
    amount_total: sessao.amount_total ?? null,
    currency: sessao.currency ?? null,
  };
}

function extrairMensagemDeErro(texto: string): string | null {
  try {
    const corpo = JSON.parse(texto) as { error?: { message?: string } };
    return corpo.error?.message ?? null;
  } catch {
    return null;
  }
}

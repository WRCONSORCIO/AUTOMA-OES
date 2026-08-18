import { prisma } from "@/lib/prisma";

/**
 * Apoio dos testes que precisam de banco.
 *
 * Os testes de fluxo do atendimento são de integração de verdade: eles gravam
 * conversa, pedido e mensagem, porque é exatamente aí que os erros aparecem —
 * um motor de fluxo testado só com dublês não prova que o estado sobrevive ao
 * banco.
 *
 * Sem banco disponível eles são pulados em vez de falharem: quem roda os testes
 * de regra pura não precisa de PostgreSQL instalado.
 */

try {
  // Node 20.12+ lê o .env sem dependência externa.
  process.loadEnvFile?.(".env");
} catch {
  // Sem .env: vale o que estiver no ambiente.
}

export async function bancoDisponivel(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Zera apenas as tabelas do atendimento, na ordem das dependências. */
export async function limparAtendimento(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "LogAtendimento",
      "EventoPagamento",
      "PedidoHistorico",
      "Pagamento",
      "Pedido",
      "MensagemAtendimento",
      "Conversa",
      "ClienteAtendimento",
      "OpcaoEtapaFluxo",
      "EtapaFluxo",
      "Fluxo",
      "Aparelho",
      "Plano",
      "ModeloMensagem",
      "HorarioAtendimento",
      "InstanciaWhatsApp"
    RESTART IDENTITY CASCADE
  `);
}

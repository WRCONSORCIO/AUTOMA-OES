import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { criarEstruturaAtendimento } from "@/server/atendimento/instalacao";
import { processarMensagemRecebida } from "@/server/atendimento/motor/executor";
import { confirmarPagamento } from "@/server/atendimento/motor/pagamento";
import type { MensagemRecebida } from "@/server/atendimento/whatsapp/tipos";
import { bancoDisponivel, limparAtendimento } from "./apoio/banco";

/**
 * Fluxo completo do atendimento, do "oi" ao encerramento.
 *
 * Cobre o que o briefing exige que não quebre: estado que sobrevive ao banco,
 * pagamento que só avança pelo gateway, webhook repetido que não libera duas
 * vezes e atendimento humano que silencia o bot.
 */

const TELEFONE = "5511999990001";

const temBanco = await bancoDisponivel();

describe.skipIf(!temBanco)("fluxo de atendimento ponta a ponta", () => {
  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = "SIMULADOR";
    process.env.WHATSAPP_PROVIDER = "SIMULADOR";

    await limparAtendimento();
    await criarEstruturaAtendimento();

    await prisma.plano.create({
      data: { nome: "Plano 30 dias", duracaoDias: 30, preco: "99.90", ordem: 0 },
    });
  });

  afterAll(async () => {
    await limparAtendimento();
  });

  it("percorre menu, plano, pagamento, aparelho e encerramento", async () => {
    await receber("oi", "m1");

    expect(await ultimaMensagemDoBot()).toContain("Como podemos ajudar");

    await receber("Nova contratação", "m2");
    expect(await ultimaMensagemDoBot()).toContain("Plano 30 dias");

    await receber("Plano 30 dias", "m3");

    const conversa = await conversaDoCliente();
    expect(conversa.status).toBe("WAITING_PAYMENT");

    const pedido = await prisma.pedido.findFirstOrThrow({ orderBy: { criadoEm: "desc" } });
    expect(pedido.status).toBe("PENDING");
    expect(pedido.valor.toString()).toBe("99.9");
    expect(await ultimaMensagemDoBot()).toContain("/pagamento/simulado/");

    // "Já paguei" não move nada: quem confirma é o gateway.
    const antes = await contarMensagensDoBot();
    await receber("já paguei", "m4");

    const aindaPendente = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(aindaPendente.status).toBe("PENDING");
    expect(await ultimaMensagemDoBot()).toContain("aguardando");
    expect(await contarMensagensDoBot()).toBe(antes + 1);

    // Confirmação do gateway destrava o fluxo.
    const confirmacao = await confirmarPagamento(pedido.id, new Date(), { origem: "webhook" });
    expect(confirmacao.aplicado).toBe(true);

    const pago = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(pago.status).toBe("PAID");
    expect(pago.pagoEm).not.toBeNull();

    const aposPagamento = await conversaDoCliente();
    expect(aposPagamento.status).toBe("BOT");

    const mensagens = await mensagensDoBot();
    expect(mensagens.join("\n")).toContain("Pagamento confirmado");
    expect(mensagens.at(-1)).toContain("TV Smart");

    // Webhook repetido: nada muda, nenhuma mensagem a mais.
    const quantidade = mensagens.length;
    const repetido = await confirmarPagamento(pedido.id, new Date(), { origem: "webhook" });
    expect(repetido.aplicado).toBe(false);
    expect(await contarMensagensDoBot()).toBe(quantidade);

    // Aparelho com fluxo próprio: entra nele.
    await receber("TV Smart", "m5");
    expect(await ultimaMensagemDoBot()).toContain("marca");

    await receber("Samsung", "m6");
    const encerrada = await conversaDoCliente();
    expect(encerrada.status).toBe("CLOSED");
  });

  it("não processa o mesmo webhook do WhatsApp duas vezes", async () => {
    const telefone = "5511999990002";
    await receber("oi", "dup1", telefone);

    const antes = await contarMensagensDoBot(telefone);
    await receber("oi", "dup1", telefone);

    expect(await contarMensagensDoBot(telefone)).toBe(antes);
  });

  it("transfere para humano e cala o bot até ser devolvido", async () => {
    const telefone = "5511999990003";
    await receber("oi", "h1", telefone);
    await receber("quero falar com um atendente", "h2", telefone);

    const conversa = await conversaDoCliente(telefone);
    expect(conversa.status).toBe("HUMAN");

    const antes = await contarMensagensDoBot(telefone);
    await receber("alguém aí?", "h3", telefone);

    expect(await contarMensagensDoBot(telefone)).toBe(antes);
  });

  it("volta de verdade para a etapa anterior", async () => {
    const telefone = "5511999990004";
    await receber("oi", "v1", telefone);
    await receber("Nova contratação", "v2", telefone);

    const naEscolha = await conversaDoCliente(telefone);
    const etapaPlano = naEscolha.etapaId;

    await receber("voltar", "v3", telefone);

    const aposVoltar = await conversaDoCliente(telefone);
    expect(aposVoltar.etapaId).not.toBe(etapaPlano);
    expect(await ultimaMensagemDoBot(telefone)).toContain("Como podemos ajudar");
  });
});

// ---------------------------------------------------------------------------

async function receber(texto: string, externoId: string, telefone = TELEFONE): Promise<void> {
  const mensagem: MensagemRecebida = {
    externoId,
    telefone,
    nomeContato: "Cliente de teste",
    texto,
    respostaSelecionada: null,
    recebidaEm: new Date(),
    daPropriaInstancia: false,
  };

  await processarMensagemRecebida(mensagem);
}

async function conversaDoCliente(telefone = TELEFONE) {
  const cliente = await prisma.clienteAtendimento.findUniqueOrThrow({ where: { telefone } });
  return prisma.conversa.findFirstOrThrow({
    where: { clienteId: cliente.id },
    orderBy: { iniciadaEm: "desc" },
  });
}

async function mensagensDoBot(telefone = TELEFONE): Promise<string[]> {
  const conversa = await conversaDoCliente(telefone);
  const mensagens = await prisma.mensagemAtendimento.findMany({
    where: { conversaId: conversa.id, origem: "BOT" },
    orderBy: { criadoEm: "asc" },
  });
  return mensagens.map((mensagem) => mensagem.conteudo);
}

async function ultimaMensagemDoBot(telefone = TELEFONE): Promise<string> {
  const mensagens = await mensagensDoBot(telefone);
  return mensagens.at(-1) ?? "";
}

async function contarMensagensDoBot(telefone = TELEFONE): Promise<number> {
  return (await mensagensDoBot(telefone)).length;
}

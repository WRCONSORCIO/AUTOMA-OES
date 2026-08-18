import { prisma } from "@/lib/prisma";
import type { SessaoUsuario } from "@/server/auth/session";
import {
  abrirSessao,
  contextoEnvio,
  entrarNaEtapa,
  etapaAtual,
  variaveis,
} from "../motor/executor";
import { registrarLog } from "./logs";
import { textoDaMensagem } from "./mensagens";

/**
 * Passagem de bastão entre bot e atendente.
 *
 * Enquanto a conversa está com uma pessoa, o bot não responde nada — é a regra
 * que evita o pior efeito de um atendimento híbrido: o robô interrompendo o
 * atendente no meio da conversa.
 *
 * Na devolução, o cliente volta exatamente para a etapa registrada, não para o
 * começo. É por isso que o estado é gravado a cada avanço.
 */

export interface ResultadoTransferencia {
  ok: boolean;
  erro?: string;
}

export async function assumirConversa(
  conversaId: string,
  usuario: Pick<SessaoUsuario, "id" | "nome">,
): Promise<ResultadoTransferencia> {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } });
  if (!conversa) return { ok: false, erro: "Conversa não encontrada." };
  if (conversa.status === "CLOSED") return { ok: false, erro: "Conversa encerrada." };

  await prisma.conversa.update({
    where: { id: conversaId },
    data: { status: "HUMAN", atendenteId: usuario.id },
  });

  await registrarLog({
    tipo: "TRANSFERENCIA_HUMANA",
    conversaId,
    clienteId: conversa.clienteId,
    descricao: `${usuario.nome} assumiu o atendimento`,
  });

  return { ok: true };
}

/**
 * Devolve a conversa ao bot e retoma a etapa onde o cliente estava.
 *
 * Quando havia pagamento pendente, o estado correto não é "conversando com o
 * bot" e sim "esperando o gateway" — devolver para BOT faria o fluxo tentar
 * avançar sem pagamento confirmado.
 */
export async function devolverAoBot(
  conversaId: string,
  usuario: Pick<SessaoUsuario, "id" | "nome">,
): Promise<ResultadoTransferencia> {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } });
  if (!conversa) return { ok: false, erro: "Conversa não encontrada." };
  if (conversa.status !== "HUMAN") return { ok: false, erro: "A conversa não está com atendente." };

  const pendente = await prisma.pedido.findFirst({
    where: {
      clienteId: conversa.clienteId,
      status: { in: ["PENDING", "PROCESSING"] },
      conversaId,
    },
  });

  await prisma.conversa.update({
    where: { id: conversaId },
    data: { status: pendente ? "WAITING_PAYMENT" : "BOT", atendenteId: null },
  });

  await registrarLog({
    tipo: "RETORNO_AO_BOT",
    conversaId,
    clienteId: conversa.clienteId,
    descricao: `${usuario.nome} devolveu a conversa ao atendimento automático`,
  });

  const sessao = await abrirSessao(conversaId);
  if (!sessao) return { ok: true };

  const aviso = await textoDaMensagem("retorno_ao_bot", await variaveis(sessao));
  if (aviso) await sessao.servico.sendText(contextoEnvio(sessao), aviso);

  // Reapresenta a etapa registrada: o cliente vê de novo o que precisa
  // responder, em vez de ficar olhando para uma conversa parada.
  const etapa = await etapaAtual(sessao.conversa);
  if (etapa && !pendente) await entrarNaEtapa(sessao, etapa, { forcarMensagem: true });

  return { ok: true };
}

/** Mensagem escrita pelo atendente no painel, enviada ao cliente. */
export async function responderComoAtendente(
  conversaId: string,
  texto: string,
  usuario: Pick<SessaoUsuario, "id" | "nome">,
): Promise<ResultadoTransferencia> {
  const conteudo = texto.trim();
  if (!conteudo) return { ok: false, erro: "Escreva a mensagem." };

  const sessao = await abrirSessao(conversaId);
  if (!sessao) return { ok: false, erro: "Conversa não encontrada." };
  if (sessao.conversa.status === "CLOSED") return { ok: false, erro: "Conversa encerrada." };

  // Responder é assumir: deixar o bot ativo enquanto a pessoa digita produziria
  // duas respostas para a mesma mensagem do cliente.
  if (sessao.conversa.status !== "HUMAN") {
    await assumirConversa(conversaId, usuario);
  }

  const resultado = await sessao.servico.sendText(
    { ...contextoEnvio(sessao), origem: "ATENDENTE", usuarioId: usuario.id },
    conteudo,
  );

  if (!resultado.sucesso) {
    return { ok: false, erro: resultado.erro ?? "Falha ao enviar a mensagem." };
  }

  return { ok: true };
}

/** Encerra a conversa pelo painel. */
export async function encerrarConversaManualmente(
  conversaId: string,
  usuario: Pick<SessaoUsuario, "id" | "nome">,
): Promise<ResultadoTransferencia> {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } });
  if (!conversa) return { ok: false, erro: "Conversa não encontrada." };

  await prisma.conversa.update({
    where: { id: conversaId },
    data: { status: "CLOSED", encerradaEm: new Date(), atendenteId: null },
  });

  await registrarLog({
    tipo: "MUDANCA_ETAPA",
    conversaId,
    clienteId: conversa.clienteId,
    descricao: `${usuario.nome} encerrou a conversa`,
  });

  return { ok: true };
}

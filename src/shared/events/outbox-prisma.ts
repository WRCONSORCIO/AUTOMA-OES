import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  EventoPublicado,
  MetadadosEvento,
  NovoEvento,
  TipoEvento,
} from "./catalogo";
import type { EventoPendente, PortaOutbox } from "./despachante";

/**
 * Implementação do outbox sobre PostgreSQL.
 *
 * É o único lugar do sistema que conhece as tabelas `EventoDominio` e
 * `EventoEntrega`. O despachante fala com a `PortaOutbox`; trocar Postgres por
 * uma fila de verdade no dia em que o volume exigir é reescrever só este
 * arquivo.
 */

/** Cliente Prisma ou transação em curso — publicar exige um dos dois. */
export type ClientePrisma = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

/**
 * Grava eventos no outbox **dentro da transação de quem chama**.
 *
 * Esse é o ponto inteiro do padrão: o fato e o evento entram juntos ou não
 * entram. Sem isso volta a existir o cenário em que a venda é gravada, o
 * processo cai, e a comissão simplesmente nunca é calculada — sem erro, sem
 * alerta, sem ninguém perceber até o fechamento não bater.
 *
 * Por isso `tx` é obrigatório e não tem valor padrão: publicar fora de
 * transação é o bug que este desenho existe para impedir.
 */
export async function publicar(
  tx: ClientePrisma,
  eventos: NovoEvento | readonly NovoEvento[],
): Promise<void> {
  const lista = Array.isArray(eventos) ? eventos : [eventos as NovoEvento];
  if (lista.length === 0) return;

  await tx.eventoDominio.createMany({ data: linhasDoOutbox(lista) });
}

/**
 * As linhas que `publicar` gravaria, sem gravá-las.
 *
 * Serve a quem monta uma transação na forma de array — `prisma.$transaction([
 * ...])` recebe operações prontas, não uma função que aguarda. A importação em
 * lote usa essa forma para mandar o lote inteiro numa só viagem ao banco, e
 * precisa da lista de eventos como mais uma operação da fila.
 *
 * Continua sendo a MESMA transação: a garantia de que fato e evento entram
 * juntos vale igual, só que na granularidade do lote.
 */
export function linhasDoOutbox(
  eventos: readonly NovoEvento[],
): Prisma.EventoDominioCreateManyInput[] {
  return eventos.map((novo) => ({
    tipo: novo.tipo,
    versao: novo.versao ?? 1,
    agregado: novo.agregado,
    agregadoId: novo.agregadoId,
    payload: novo.payload as Prisma.InputJsonValue,
    metadados: (novo.metadados ?? {}) as Prisma.InputJsonValue,
    ocorridoEm: novo.ocorridoEm ?? new Date(),
  }));
}

// ---------------------------------------------------------------------------
// Porta do despachante
// ---------------------------------------------------------------------------

function paraEventoPublicado(linha: {
  id: string;
  tipo: string;
  versao: number;
  agregado: string;
  agregadoId: string;
  payload: Prisma.JsonValue;
  metadados: Prisma.JsonValue | null;
  ocorridoEm: Date;
}): EventoPublicado {
  return {
    id: linha.id,
    tipo: linha.tipo as TipoEvento,
    versao: linha.versao,
    agregado: linha.agregado,
    agregadoId: linha.agregadoId,
    payload: linha.payload as EventoPublicado["payload"],
    metadados: (linha.metadados ?? {}) as MetadadosEvento,
    ocorridoEm: linha.ocorridoEm,
  };
}

export const outboxPrisma: PortaOutbox = {
  async buscarPendentes(limite: number, agora: Date): Promise<EventoPendente[]> {
    const linhas = await prisma.eventoDominio.findMany({
      where: {
        status: "PENDENTE",
        OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }],
      },
      // Pela ocorrência do fato, não pela gravação: mantém a ordem causal
      // mesmo quando um evento antigo entra atrasado por retry.
      orderBy: [{ ocorridoEm: "asc" }, { id: "asc" }],
      take: limite,
    });

    return linhas.map((linha) => ({
      evento: paraEventoPublicado(linha),
      tentativas: linha.tentativas,
    }));
  },

  async marcarProcessados(eventoIds: readonly string[], agora: Date): Promise<void> {
    await prisma.eventoDominio.updateMany({
      where: { id: { in: [...eventoIds] } },
      data: { status: "PROCESSADO", processadoEm: agora, ultimoErro: null },
    });
  },

  async marcarFalha(
    eventoId: string,
    erro: string,
    proximaTentativaEm: Date | null,
    agora: Date,
  ): Promise<void> {
    await prisma.eventoDominio.update({
      where: { id: eventoId },
      data: {
        // Sem próxima tentativa = esgotou o retry. Vira FALHA definitiva, que
        // é o que o dashboard mostra como alerta em vez de deixar sumir.
        status: proximaTentativaEm ? "PENDENTE" : "FALHA",
        tentativas: { increment: 1 },
        proximaTentativaEm,
        ultimoErro: erro.slice(0, 2000),
        processadoEm: proximaTentativaEm ? null : agora,
      },
    });
  },

  async reservarEntrega(eventoId: string, handler: string): Promise<boolean> {
    try {
      await prisma.eventoEntrega.create({
        data: { eventoId, handler, status: "PROCESSANDO", tentativas: 1 },
      });
      return true;
    } catch (erro) {
      if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") {
        throw erro;
      }
    }

    // P2002 = a dupla (eventoId, handler) já existe. Duas situações muito
    // diferentes se escondem aqui:
    //
    //   PROCESSADO  → já aplicado. Não repetir é a idempotência funcionando.
    //   PROCESSANDO → outro processo está com ele agora. Também não repetir.
    //   PENDENTE    → tentativa anterior falhou e liberou. Este retry pode pegar.
    //
    // O `updateMany` com o status no `where` é um compare-and-swap: só um
    // processo consegue tirar a linha de PENDENTE, e o Postgres arbitra. Fazer
    // isso como `findFirst` seguido de `update` teria janela de corrida em que
    // dois processos aplicariam o mesmo evento.
    const { count } = await prisma.eventoEntrega.updateMany({
      where: { eventoId, handler, status: "PENDENTE" },
      data: { status: "PROCESSANDO", tentativas: { increment: 1 } },
    });
    return count === 1;
  },

  async concluirEntrega(
    eventoId: string,
    handler: string,
    duracaoMs: number,
  ): Promise<void> {
    await prisma.eventoEntrega.update({
      where: { eventoId_handler: { eventoId, handler } },
      data: { status: "PROCESSADO", concluidoEm: new Date(), duracaoMs, erro: null },
    });
  },

  async falharEntrega(eventoId: string, handler: string, erro: string): Promise<void> {
    // Volta a PENDENTE para que o próximo ciclo possa reservar de novo,
    // preservando o contador de tentativas. Apagar e recriar a linha zeraria o
    // histórico e abriria uma janela em que a entrega não existe.
    await prisma.eventoEntrega.update({
      where: { eventoId_handler: { eventoId, handler } },
      data: { status: "PENDENTE", erro: erro.slice(0, 2000) },
    });
  },
};

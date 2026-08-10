import type { EventoPublicado } from "./catalogo";
import type { RegistroHandlers } from "./registro";

/**
 * Despachante do outbox.
 *
 * Lê os eventos pendentes, entrega a cada handler inscrito e fecha o evento.
 * Toda a persistência passa por `PortaOutbox`, então esta lógica — que é onde
 * moram as decisões difíceis (idempotência, retry, isolamento de falha) — roda
 * em teste sem banco nenhum.
 *
 * Três garantias:
 *
 * 1. **Idempotência.** A entrega é reservada em `(eventoId, handler)` antes de
 *    executar. Reservar duas vezes é impossível, então o handler nunca aplica o
 *    mesmo evento duas vezes — nem com retry, nem com dois processos rodando.
 * 2. **Isolamento de falha.** Um handler que quebra não impede os outros do
 *    mesmo evento de rodar. O evento só é dado por processado quando todos
 *    concluem.
 * 3. **Retry com backoff.** Falha não perde o evento: ele volta para a fila com
 *    espera crescente, e o erro fica visível em vez de sumir no log.
 */

/**
 * Evento pendente, com o estado de retry que só interessa ao despachante.
 *
 * `tentativas` fica fora de `EventoPublicado` de propósito: é detalhe de
 * infraestrutura. O handler recebe o fato de domínio e não deve nem conseguir
 * se comportar diferente na segunda tentativa.
 */
export interface EventoPendente {
  readonly evento: EventoPublicado;
  readonly tentativas: number;
}

export interface PortaOutbox {
  /** Pendentes cujo backoff já venceu, mais antigos primeiro. */
  buscarPendentes(limite: number, agora: Date): Promise<EventoPendente[]>;
  /**
   * Fecha de uma vez todos os eventos da rodada que correram sem erro.
   *
   * É seguro fechar só no fim porque a proteção contra repetição não está
   * aqui: está na reserva de `(eventoId, handler)`. O processo caindo depois
   * dos handlers e antes deste fechamento faz o evento voltar na próxima
   * rodada, e a reserva já existente impede que ele seja aplicado de novo.
   */
  marcarProcessados(eventoIds: readonly string[], agora: Date): Promise<void>;
  marcarFalha(
    eventoId: string,
    erro: string,
    proximaTentativaEm: Date | null,
    agora: Date,
  ): Promise<void>;

  /**
   * Reserva a entrega deste evento a este handler.
   *
   * `false` = já reservada antes, ou seja, já processada ou em processamento.
   * A exclusividade vem do índice único `(eventoId, handler)` no banco, não de
   * um `select` seguido de `insert` — que teria janela de corrida.
   */
  reservarEntrega(eventoId: string, handler: string): Promise<boolean>;
  concluirEntrega(eventoId: string, handler: string, duracaoMs: number): Promise<void>;
  falharEntrega(eventoId: string, handler: string, erro: string): Promise<void>;
}

export interface OpcoesDespacho {
  /** Eventos por rodada. Segura a memória e o tempo de uma execução. */
  readonly lote?: number;
  /** Tentativas antes de desistir e marcar FALHA definitiva. */
  readonly maxTentativas?: number;
  readonly agora?: () => Date;
}

export interface ResumoDespacho {
  readonly eventos: number;
  readonly entregasOk: number;
  readonly entregasIgnoradas: number;
  readonly entregasFalhas: number;
  readonly eventosComFalha: number;
}

const LOTE_PADRAO = 100;
const MAX_TENTATIVAS_PADRAO = 5;

/**
 * Espera antes da próxima tentativa: 2^n segundos, teto de 1 hora.
 *
 * Cresce rápido o bastante para não martelar um banco em apuros, e para o
 * suficiente para que uma falha real não fique invisível por meio dia.
 * `null` = acabaram as tentativas.
 */
export function calcularBackoff(
  tentativas: number,
  maxTentativas: number,
  agora: Date,
): Date | null {
  if (tentativas >= maxTentativas) return null;
  const segundos = Math.min(2 ** tentativas, 3600);
  return new Date(agora.getTime() + segundos * 1000);
}

function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`;
  return String(erro);
}

export async function despachar(
  porta: PortaOutbox,
  registro: RegistroHandlers,
  opcoes: OpcoesDespacho = {},
): Promise<ResumoDespacho> {
  const lote = opcoes.lote ?? LOTE_PADRAO;
  const maxTentativas = opcoes.maxTentativas ?? MAX_TENTATIVAS_PADRAO;
  const relogio = opcoes.agora ?? (() => new Date());

  const pendentes = await porta.buscarPendentes(lote, relogio());

  let entregasOk = 0;
  let entregasIgnoradas = 0;
  let entregasFalhas = 0;
  let eventosComFalha = 0;
  const concluidos: string[] = [];

  for (const { evento, tentativas } of pendentes) {
    const handlers = registro.para(evento.tipo);
    const erros: string[] = [];

    for (const handler of handlers) {
      const reservou = await porta.reservarEntrega(evento.id, handler.nome);
      if (!reservou) {
        entregasIgnoradas += 1;
        continue;
      }

      const inicio = Date.now();
      try {
        await handler.executar(evento);
        await porta.concluirEntrega(evento.id, handler.nome, Date.now() - inicio);
        entregasOk += 1;
      } catch (erro) {
        // Falha de um handler não cancela os demais: cada reação é
        // independente, e derrubar todas por causa de uma só amplia o estrago.
        const descricao = descreverErro(erro);
        erros.push(`${handler.nome}: ${descricao}`);
        await porta.falharEntrega(evento.id, handler.nome, descricao);
        entregasFalhas += 1;
      }
    }

    if (erros.length === 0) {
      concluidos.push(evento.id);
      continue;
    }

    const momento = relogio();
    eventosComFalha += 1;
    // `tentativas` é o que já foi gasto; esta rodada é a seguinte. Passar o
    // valor real é o que faz o backoff crescer de fato a cada retry.
    await porta.marcarFalha(
      evento.id,
      erros.join(" | "),
      calcularBackoff(tentativas + 1, maxTentativas, momento),
      momento,
    );
  }

  if (concluidos.length > 0) await porta.marcarProcessados(concluidos, relogio());

  return {
    eventos: pendentes.length,
    entregasOk,
    entregasIgnoradas,
    entregasFalhas,
    eventosComFalha,
  };
}

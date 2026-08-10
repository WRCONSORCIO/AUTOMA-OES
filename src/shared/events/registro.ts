import type { EventoPublicado, TipoEvento } from "./catalogo";

/**
 * Registro de handlers por tipo de evento.
 *
 * Substitui o `switch` gigante que todo despachante ganha com o tempo: o
 * handler declara a que evento responde e se registra. Adicionar uma reação
 * nova nunca exige tocar no despachante.
 *
 * Módulo puro: sem banco, sem I/O. Testável sozinho.
 */

export interface Handler<T extends TipoEvento = TipoEvento> {
  /**
   * Identidade estável do handler. **É a chave de idempotência** — a dupla
   * `(eventoId, nome)` garante que o mesmo evento nunca é aplicado duas vezes
   * pelo mesmo handler.
   *
   * Renomear um handler já em produção faz o sistema reprocessar todo o
   * histórico dele. Trate este nome como parte do contrato, não como rótulo.
   */
  readonly nome: string;
  readonly evento: T;
  /** Menor executa primeiro. Use só quando a ordem for realmente exigida. */
  readonly prioridade?: number;
  executar(evento: EventoPublicado<T>): Promise<void>;
}

export class RegistroHandlers {
  private readonly porTipo = new Map<TipoEvento, Handler[]>();
  private readonly nomes = new Set<string>();

  /**
   * Nome duplicado é erro de programação, não condição de runtime: dois
   * handlers com o mesmo nome colidiriam na chave de idempotência e um deles
   * silenciosamente nunca rodaria. Falha alto e cedo.
   */
  registrar<T extends TipoEvento>(handler: Handler<T>): this {
    if (this.nomes.has(handler.nome)) {
      throw new Error(
        `Handler duplicado: "${handler.nome}". O nome é a chave de idempotência e precisa ser único.`,
      );
    }
    this.nomes.add(handler.nome);

    const lista = this.porTipo.get(handler.evento) ?? [];
    lista.push(handler as Handler);
    lista.sort((a, b) => (a.prioridade ?? 100) - (b.prioridade ?? 100));
    this.porTipo.set(handler.evento, lista);
    return this;
  }

  registrarTodos(handlers: readonly Handler<never>[]): this {
    for (const handler of handlers) this.registrar(handler);
    return this;
  }

  /** Handlers inscritos no tipo, já na ordem de execução. */
  para(tipo: TipoEvento): readonly Handler[] {
    return this.porTipo.get(tipo) ?? [];
  }

  /** Tipos que têm ao menos um inscrito. Evento sem inscrito é fechado direto. */
  tiposInscritos(): TipoEvento[] {
    return [...this.porTipo.keys()];
  }
}

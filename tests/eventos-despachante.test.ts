import { describe, expect, it } from "vitest";
import type { EventoPublicado } from "@/shared/events/catalogo";
import {
  calcularBackoff,
  despachar,
  type EventoPendente,
  type PortaOutbox,
} from "@/shared/events/despachante";
import { RegistroHandlers } from "@/shared/events/registro";

/**
 * Outbox em memória com a MESMA semântica do Postgres: a reserva é exclusiva e
 * só pode ser retomada quando a entrega está PENDENTE. É isso que faz o teste
 * dizer algo sobre o comportamento real.
 */
function outboxFake(eventos: EventoPendente[]): PortaOutbox & {
  readonly processados: string[];
  readonly falhados: Map<string, string>;
  readonly entregas: Map<string, string>;
} {
  const processados: string[] = [];
  const falhados = new Map<string, string>();
  const entregas = new Map<string, string>();
  const chave = (eventoId: string, handler: string) => `${eventoId}::${handler}`;

  return {
    processados,
    falhados,
    entregas,
    async buscarPendentes(limite) {
      return eventos.slice(0, limite);
    },
    async marcarProcessado(eventoId) {
      processados.push(eventoId);
    },
    async marcarFalha(eventoId, erro) {
      falhados.set(eventoId, erro);
    },
    async reservarEntrega(eventoId, handler) {
      const k = chave(eventoId, handler);
      const atual = entregas.get(k);
      if (atual === undefined || atual === "PENDENTE") {
        entregas.set(k, "PROCESSANDO");
        return true;
      }
      return false;
    },
    async concluirEntrega(eventoId, handler) {
      entregas.set(chave(eventoId, handler), "PROCESSADO");
    },
    async falharEntrega(eventoId, handler) {
      entregas.set(chave(eventoId, handler), "PENDENTE");
    },
  };
}

const pendente = (id: string, tipo = "carteira.cota.cancelada"): EventoPendente => ({
  tentativas: 0,
  evento: {
    id,
    tipo,
    versao: 1,
    agregado: "Cota",
    agregadoId: `cota-${id}`,
    payload: {},
    metadados: {},
    ocorridoEm: new Date("2025-06-10T12:00:00Z"),
  } as unknown as EventoPublicado,
});

describe("despachante de eventos", () => {
  it("entrega o evento a todos os handlers inscritos no tipo", async () => {
    const vistos: string[] = [];
    const registro = new RegistroHandlers()
      .registrar({
        nome: "gera-estorno",
        evento: "carteira.cota.cancelada",
        async executar(e) {
          vistos.push(`estorno:${e.id}`);
        },
      })
      .registrar({
        nome: "notifica",
        evento: "carteira.cota.cancelada",
        async executar(e) {
          vistos.push(`notifica:${e.id}`);
        },
      });

    const porta = outboxFake([pendente("ev-1")]);
    const resumo = await despachar(porta, registro);

    expect(vistos).toEqual(["estorno:ev-1", "notifica:ev-1"]);
    expect(resumo.entregasOk).toBe(2);
    expect(porta.processados).toEqual(["ev-1"]);
  });

  it("respeita a prioridade quando a ordem importa", async () => {
    const ordem: string[] = [];
    const registro = new RegistroHandlers()
      .registrar({
        nome: "depois",
        evento: "carteira.cota.cancelada",
        prioridade: 20,
        async executar() {
          ordem.push("depois");
        },
      })
      .registrar({
        nome: "antes",
        evento: "carteira.cota.cancelada",
        prioridade: 10,
        async executar() {
          ordem.push("antes");
        },
      });

    await despachar(outboxFake([pendente("ev-1")]), registro);
    expect(ordem).toEqual(["antes", "depois"]);
  });

  it("NÃO aplica o mesmo evento duas vezes ao mesmo handler", async () => {
    let execucoes = 0;
    const registro = new RegistroHandlers().registrar({
      nome: "apura",
      evento: "carteira.cota.cancelada",
      async executar() {
        execucoes += 1;
      },
    });

    const porta = outboxFake([pendente("ev-1")]);
    await despachar(porta, registro);
    // Segunda rodada com o mesmo evento — cenário real de retry ou de dois
    // processos concorrentes. Não pode gerar estorno em dobro.
    const segunda = await despachar(porta, registro);

    expect(execucoes).toBe(1);
    expect(segunda.entregasIgnoradas).toBe(1);
  });

  it("handler que quebra não impede os outros de rodarem", async () => {
    const rodou: string[] = [];
    const registro = new RegistroHandlers()
      .registrar({
        nome: "quebra",
        evento: "carteira.cota.cancelada",
        prioridade: 1,
        async executar() {
          throw new Error("banco fora do ar");
        },
      })
      .registrar({
        nome: "segue",
        evento: "carteira.cota.cancelada",
        prioridade: 2,
        async executar() {
          rodou.push("segue");
        },
      });

    const porta = outboxFake([pendente("ev-1")]);
    const resumo = await despachar(porta, registro);

    expect(rodou).toEqual(["segue"]);
    expect(resumo.entregasOk).toBe(1);
    expect(resumo.entregasFalhas).toBe(1);
    // O evento NÃO é dado por concluído enquanto um handler estiver falhando.
    expect(porta.processados).toEqual([]);
    expect(porta.falhados.get("ev-1")).toContain("banco fora do ar");
  });

  it("retry reexecuta só o handler que falhou, nunca o que já concluiu", async () => {
    let tentativasQuebra = 0;
    let execucoesOk = 0;
    const registro = new RegistroHandlers()
      .registrar({
        nome: "instavel",
        evento: "carteira.cota.cancelada",
        async executar() {
          tentativasQuebra += 1;
          if (tentativasQuebra === 1) throw new Error("timeout");
        },
      })
      .registrar({
        nome: "estavel",
        evento: "carteira.cota.cancelada",
        async executar() {
          execucoesOk += 1;
        },
      });

    const porta = outboxFake([pendente("ev-1")]);
    await despachar(porta, registro);
    await despachar(porta, registro);

    expect(tentativasQuebra).toBe(2);
    expect(execucoesOk).toBe(1);
    expect(porta.processados).toEqual(["ev-1"]);
  });

  it("evento sem handler inscrito é fechado, não fica preso na fila", async () => {
    const porta = outboxFake([pendente("ev-1", "ingestao.importacao.concluida")]);
    const resumo = await despachar(porta, new RegistroHandlers());

    expect(resumo.entregasOk).toBe(0);
    expect(porta.processados).toEqual(["ev-1"]);
  });
});

describe("registro de handlers", () => {
  it("recusa nome duplicado — colidiria na chave de idempotência", () => {
    const registro = new RegistroHandlers().registrar({
      nome: "apura",
      evento: "carteira.cota.cancelada",
      async executar() {},
    });

    expect(() =>
      registro.registrar({
        nome: "apura",
        evento: "carteira.cota.criada",
        async executar() {},
      }),
    ).toThrow(/duplicado/i);
  });
});

describe("backoff", () => {
  const agora = new Date("2025-06-10T12:00:00Z");

  it("cresce exponencialmente a cada tentativa", () => {
    const espera = (n: number) =>
      (calcularBackoff(n, 10, agora)!.getTime() - agora.getTime()) / 1000;
    expect(espera(1)).toBe(2);
    expect(espera(2)).toBe(4);
    expect(espera(3)).toBe(8);
  });

  it("tem teto de uma hora, para não adiar a falha indefinidamente", () => {
    const espera = (calcularBackoff(30, 100, agora)!.getTime() - agora.getTime()) / 1000;
    expect(espera).toBe(3600);
  });

  it("devolve null ao esgotar as tentativas, virando falha definitiva", () => {
    expect(calcularBackoff(5, 5, agora)).toBeNull();
  });
});

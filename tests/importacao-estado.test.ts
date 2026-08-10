import { describe, expect, it } from "vitest";
import {
  estadoDaImportacao,
  MINUTOS_ATE_CONSIDERAR_INTERROMPIDA,
} from "@/server/domain/importacao-estado";

/**
 * Uma importação cujo processo morre no meio fica gravada como PROCESSANDO
 * para sempre: não sobra ninguém para corrigir o status. A tela mostrava
 * trabalho em andamento onde havia falha silenciosa.
 */
describe("estado da importação", () => {
  const agora = new Date("2026-08-10T18:00:00Z");
  const minutosAtras = (n: number) => new Date(agora.getTime() - n * 60_000);

  it("respeita o status gravado quando ele é terminal", () => {
    for (const status of ["CONCLUIDA", "CONCLUIDA_COM_ERROS", "FALHA", "PENDENTE"]) {
      expect(
        estadoDaImportacao({ status, iniciadoEm: minutosAtras(600) }, agora),
      ).toBe(status);
    }
  });

  it("importação recente em PROCESSANDO está mesmo processando", () => {
    expect(
      estadoDaImportacao({ status: "PROCESSANDO", iniciadoEm: minutosAtras(1) }, agora),
    ).toBe("PROCESSANDO");
  });

  it("passado o limite, PROCESSANDO só pode significar interrompida", () => {
    expect(
      estadoDaImportacao(
        { status: "PROCESSANDO", iniciadoEm: minutosAtras(MINUTOS_ATE_CONSIDERAR_INTERROMPIDA + 1) },
        agora,
      ),
    ).toBe("INTERROMPIDA");
  });

  it("no limite exato ainda dá o benefício da dúvida", () => {
    // Falso positivo aqui é pior que o problema: acusaria de morta uma
    // importação que ainda vai terminar.
    expect(
      estadoDaImportacao(
        { status: "PROCESSANDO", iniciadoEm: minutosAtras(MINUTOS_ATE_CONSIDERAR_INTERROMPIDA) },
        agora,
      ),
    ).toBe("PROCESSANDO");
  });

  it("a dedução some sozinha quando a importação de fato termina", () => {
    // É a vantagem de derivar em vez de marcar: nada precisa ser desfeito.
    expect(
      estadoDaImportacao({ status: "CONCLUIDA", iniciadoEm: minutosAtras(9999) }, agora),
    ).toBe("CONCLUIDA");
  });
});

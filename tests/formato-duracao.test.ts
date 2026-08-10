import { describe, expect, it } from "vitest";
import { formatarDuracao } from "@/lib/format";

describe("duração", () => {
  const inicio = new Date("2026-08-10T12:00:00.000Z");
  const mais = (ms: number) => new Date(inicio.getTime() + ms);

  it("mostra milissegundos abaixo de um segundo", () => {
    expect(formatarDuracao(inicio, mais(430))).toBe("430 ms");
  });

  it("mostra segundos com uma casa — é a escala da importação", () => {
    expect(formatarDuracao(inicio, mais(14_300))).toBe("14.3 s");
  });

  it("passa a minutos quando o segundo deixa de caber na cabeça", () => {
    expect(formatarDuracao(inicio, mais(95_000))).toBe("1min 35s");
  });

  it("sem fim não há duração: a operação não terminou", () => {
    expect(formatarDuracao(inicio, null)).toBe("—");
    expect(formatarDuracao(null, mais(1000))).toBe("—");
  });

  it("relógio que andou para trás não vira duração negativa", () => {
    expect(formatarDuracao(mais(1000), inicio)).toBe("—");
  });
});

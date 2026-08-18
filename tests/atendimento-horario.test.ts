import { describe, expect, it } from "vitest";
import {
  dentroDoHorario,
  descreverHorarios,
  type DiaAtendimento,
} from "@/server/atendimento/dominio/horario";

const PADRAO: DiaAtendimento[] = [
  { diaSemana: 0, abertura: "08:00", fechamento: "12:00", fechado: true },
  ...[1, 2, 3, 4, 5].map((diaSemana) => ({
    diaSemana,
    abertura: "08:00",
    fechamento: "18:00",
    fechado: false,
  })),
  { diaSemana: 6, abertura: "08:00", fechamento: "12:00", fechado: false },
];

/** 2026-08-17 é uma segunda-feira. */
function segunda(hora: string): Date {
  return new Date(`2026-08-17T${hora}:00`);
}

describe("horário de atendimento humano", () => {
  it("reconhece dentro e fora do expediente", () => {
    expect(dentroDoHorario(PADRAO, segunda("09:30"))).toBe(true);
    expect(dentroDoHorario(PADRAO, segunda("07:59"))).toBe(false);
    expect(dentroDoHorario(PADRAO, segunda("18:00"))).toBe(false);
  });

  it("dia marcado como fechado nunca está aberto", () => {
    // Domingo.
    expect(dentroDoHorario(PADRAO, new Date("2026-08-16T10:00:00"))).toBe(false);
  });

  it("dia sem configuração é considerado aberto", () => {
    // Melhor transferir para um humano indevidamente do que deixar o cliente
    // sem resposta por causa de cadastro incompleto.
    expect(dentroDoHorario([], segunda("03:00"))).toBe(true);
  });

  it("hora inválida não fecha o atendimento por engano", () => {
    const quebrado: DiaAtendimento[] = [
      { diaSemana: 1, abertura: "oito", fechamento: "18:00", fechado: false },
    ];
    expect(dentroDoHorario(quebrado, segunda("09:00"))).toBe(true);
  });

  it("descreve o horário agrupando dias seguidos iguais", () => {
    expect(descreverHorarios(PADRAO)).toBe(
      "Domingo fechado, Segunda a Sexta 08:00–18:00, Sábado 08:00–12:00",
    );
  });

  it("sem configuração, diz que não está configurado", () => {
    expect(descreverHorarios([])).toBe("não configurado");
  });
});

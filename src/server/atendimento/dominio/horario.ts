/**
 * Horário de atendimento humano.
 *
 * O bot funciona 24 horas: pagamento, instrução e fluxo não dependem de gente.
 * Só o pedido de atendente respeita o horário — fora dele, a conversa fica
 * registrada e o cliente é avisado, em vez de esperar resposta que não vem.
 */

export interface DiaAtendimento {
  diaSemana: number;
  abertura: string;
  fechamento: string;
  fechado: boolean;
}

const DIAS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

function minutos(hora: string): number | null {
  const partes = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!partes) return null;

  const h = Number(partes[1]);
  const m = Number(partes[2]);
  if (h > 23 || m > 59) return null;

  return h * 60 + m;
}

export function dentroDoHorario(horarios: readonly DiaAtendimento[], agora: Date): boolean {
  const dia = horarios.find((item) => item.diaSemana === agora.getDay());
  // Sem configuração para o dia, o atendimento é considerado aberto: é melhor
  // transferir para um humano indevidamente do que deixar o cliente sem
  // resposta por causa de cadastro incompleto.
  if (!dia) return true;
  if (dia.fechado) return false;

  const abertura = minutos(dia.abertura);
  const fechamento = minutos(dia.fechamento);
  if (abertura === null || fechamento === null) return true;

  const agoraEmMinutos = agora.getHours() * 60 + agora.getMinutes();
  return agoraEmMinutos >= abertura && agoraEmMinutos < fechamento;
}

/** Texto de `{{business_hours}}`, agrupando dias seguidos com o mesmo horário. */
export function descreverHorarios(horarios: readonly DiaAtendimento[]): string {
  const ordenados = [...horarios].sort((a, b) => a.diaSemana - b.diaSemana);
  if (ordenados.length === 0) return "não configurado";

  const blocos: { inicio: number; fim: number; texto: string }[] = [];

  for (const dia of ordenados) {
    const texto = dia.fechado ? "fechado" : `${dia.abertura}–${dia.fechamento}`;
    const ultimo = blocos.at(-1);

    if (ultimo && ultimo.texto === texto && ultimo.fim === dia.diaSemana - 1) {
      ultimo.fim = dia.diaSemana;
      continue;
    }
    blocos.push({ inicio: dia.diaSemana, fim: dia.diaSemana, texto });
  }

  return blocos
    .map((bloco) => {
      const nome =
        bloco.inicio === bloco.fim
          ? DIAS[bloco.inicio]
          : `${DIAS[bloco.inicio]} a ${DIAS[bloco.fim]}`;
      return `${nome} ${bloco.texto}`;
    })
    .join(", ");
}

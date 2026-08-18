/**
 * Janela de tempo do painel de atendimento.
 *
 * Fica separada da tela porque três páginas usam a mesma janela (visão geral,
 * pedidos e logs) e um período calculado de dois jeitos diferentes daria dois
 * números diferentes para o mesmo dia.
 */

export const PERIODOS = {
  hoje: "Hoje",
  "7dias": "7 dias",
  "30dias": "30 dias",
  personalizado: "Personalizado",
} as const;

export type ChavePeriodo = keyof typeof PERIODOS;

export interface IntervaloPeriodo {
  chave: ChavePeriodo;
  inicio: Date;
  fim: Date;
  de: string;
  ate: string;
}

type Parametros = Record<string, string | string[] | undefined>;

function primeiro(parametros: Parametros, chave: string): string | undefined {
  const valor = parametros[chave];
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return bruto?.trim() || undefined;
}

function inicioDoDia(data: Date): Date {
  const copia = new Date(data);
  copia.setHours(0, 0, 0, 0);
  return copia;
}

function fimDoDia(data: Date): Date {
  const copia = new Date(data);
  copia.setHours(23, 59, 59, 999);
  return copia;
}

function iso(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

export function intervaloDoPeriodo(
  chave: ChavePeriodo | undefined,
  parametros: Parametros = {},
  agora: Date = new Date(),
): IntervaloPeriodo {
  const de = primeiro(parametros, "de");
  const ate = primeiro(parametros, "ate");

  // Data informada manualmente vence a chave: quem digitou o intervalo quer o
  // intervalo digitado, mesmo que o botão "Hoje" continue marcado.
  if (chave === "personalizado" || (de && ate)) {
    const inicio = de ? inicioDoDia(new Date(`${de}T00:00:00`)) : inicioDoDia(agora);
    const fim = ate ? fimDoDia(new Date(`${ate}T00:00:00`)) : fimDoDia(agora);
    if (!Number.isNaN(inicio.getTime()) && !Number.isNaN(fim.getTime())) {
      return { chave: "personalizado", inicio, fim, de: iso(inicio), ate: iso(fim) };
    }
  }

  const dias = chave === "7dias" ? 6 : chave === "30dias" ? 29 : 0;
  const inicio = inicioDoDia(new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000));
  const fim = fimDoDia(agora);

  return {
    chave: chave && chave in PERIODOS ? chave : "hoje",
    inicio,
    fim,
    de: iso(inicio),
    ate: iso(fim),
  };
}

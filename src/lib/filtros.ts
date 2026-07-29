import { parseDataBr } from "./normalize";

export type ParametrosBusca = Record<string, string | string[] | undefined>;

export function texto(parametros: ParametrosBusca, chave: string): string | undefined {
  const valor = parametros[chave];
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const limpo = bruto?.trim();
  return limpo ? limpo : undefined;
}

export function data(parametros: ParametrosBusca, chave: string): Date | undefined {
  const valor = texto(parametros, chave);
  if (!valor) return undefined;
  return parseDataBr(valor) ?? undefined;
}

export function inteiro(
  parametros: ParametrosBusca,
  chave: string,
  padrao: number,
  minimo = 1,
): number {
  const valor = Number(texto(parametros, chave));
  if (!Number.isFinite(valor)) return padrao;
  return Math.max(minimo, Math.trunc(valor));
}

/** Primeiro e último dia do mês corrente, usados como período padrão. */
export function periodoPadrao(): { de: Date; ate: Date } {
  const agora = new Date();
  const de = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const ate = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 0));
  return { de, ate };
}

export function paraInputDate(valor: Date | undefined): string {
  if (!valor) return "";
  return valor.toISOString().slice(0, 10);
}

export function montarQuery(
  base: ParametrosBusca,
  alteracoes: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [chave, valor] of Object.entries(base)) {
    const primeiro = Array.isArray(valor) ? valor[0] : valor;
    if (primeiro) query.set(chave, primeiro);
  }

  for (const [chave, valor] of Object.entries(alteracoes)) {
    if (valor === undefined || valor === "") query.delete(chave);
    else query.set(chave, String(valor));
  }

  const texto = query.toString();
  return texto ? `?${texto}` : "";
}

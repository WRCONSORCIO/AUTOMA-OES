/**
 * Substituição de variáveis nas mensagens configuradas pelo administrador.
 *
 * O painel edita texto com `{{plano}}`; o motor troca pelo valor real na hora
 * do envio. Variável desconhecida some do texto em vez de aparecer crua para o
 * cliente — mensagem com `{{payment_link}}` visível é pior do que mensagem sem
 * o link.
 */

export type Variaveis = Record<string, string | number | null | undefined>;

/** Variáveis reconhecidas, exibidas como ajuda no painel. */
export const VARIAVEIS_DISPONIVEIS = [
  "customer_name",
  "plan_name",
  "plan_price",
  "plan_duration",
  "payment_link",
  "order_id",
  "device_name",
  "business_hours",
] as const;

const PADRAO = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function aplicarVariaveis(texto: string, variaveis: Variaveis): string {
  return texto.replace(PADRAO, (_todo, chave: string) => {
    const valor = variaveis[chave];
    if (valor === null || valor === undefined) return "";
    return String(valor);
  });
}

/** Nomes das variáveis usadas no texto. Serve para avisar o administrador. */
export function variaveisUsadas(texto: string): string[] {
  return [...texto.matchAll(PADRAO)].map((achado) => achado[1]!);
}

/** Variáveis do texto que o sistema não sabe preencher. */
export function variaveisDesconhecidas(texto: string): string[] {
  const conhecidas = new Set<string>(VARIAVEIS_DISPONIVEIS);
  return [...new Set(variaveisUsadas(texto))].filter((nome) => !conhecidas.has(nome));
}

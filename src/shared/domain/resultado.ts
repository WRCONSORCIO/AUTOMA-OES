/**
 * Resultado explícito de uma operação de domínio.
 *
 * Regra de negócio não lança exceção: falha esperada é valor de retorno, não
 * fluxo excepcional. Exceção fica reservada para o que é realmente inesperado
 * (banco fora do ar, bug). A diferença importa porque o compilador cobra o
 * tratamento de um `Resultado`, mas nunca cobra o `catch` de uma exceção.
 */

export type Resultado<T, E = FalhaDominio> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly erro: E };

export interface FalhaDominio {
  /** Código estável, seguro para comparar em teste e traduzir em tela. */
  readonly codigo: string;
  readonly mensagem: string;
  readonly detalhes?: Readonly<Record<string, unknown>>;
}

export function sucesso<T>(valor: T): Resultado<T, never> {
  return { ok: true, valor };
}

export function falha<E = FalhaDominio>(erro: E): Resultado<never, E> {
  return { ok: false, erro };
}

export function falhaDominio(
  codigo: string,
  mensagem: string,
  detalhes?: Record<string, unknown>,
): Resultado<never, FalhaDominio> {
  return { ok: false, erro: { codigo, mensagem, detalhes } };
}

/** Encadeia operações que também podem falhar, parando na primeira falha. */
export function encadear<T, U, E>(
  resultado: Resultado<T, E>,
  proximo: (valor: T) => Resultado<U, E>,
): Resultado<U, E> {
  return resultado.ok ? proximo(resultado.valor) : resultado;
}

/**
 * Coleta uma lista de resultados em um resultado de lista.
 *
 * Falha no primeiro erro: numa importação, meia dúzia de linhas boas não
 * justifica gravar um lote que já se sabe inconsistente.
 */
export function todos<T, E>(resultados: readonly Resultado<T, E>[]): Resultado<T[], E> {
  const valores: T[] = [];
  for (const resultado of resultados) {
    if (!resultado.ok) return resultado;
    valores.push(resultado.valor);
  }
  return sucesso(valores);
}

/** Desembrulha ou lança. Use só na fronteira, quando a falha já é impossível. */
export function ouLance<T, E>(resultado: Resultado<T, E>): T {
  if (resultado.ok) return resultado.valor;
  const erro = resultado.erro as FalhaDominio;
  throw new Error(erro?.mensagem ?? "Operação de domínio falhou");
}

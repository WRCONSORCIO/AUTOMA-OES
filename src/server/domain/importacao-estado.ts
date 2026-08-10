/**
 * O estado real de uma importação, que nem sempre é o que está gravado.
 *
 * `PROCESSANDO` significa "começou e ainda não terminou" — mas a linha só sai
 * desse estado se o processo que a criou continuar vivo até o fim. Quando ele
 * morre no meio (limite de execução do servidor estourado, instância
 * reciclada), ninguém volta para corrigir o status: a importação fica
 * "processando" indefinidamente, e a tela mostra trabalho em andamento onde há
 * uma falha silenciosa.
 *
 * A correção é derivar em vez de gravar. Nenhuma importação legítima passa do
 * limite da plataforma, então uma que está em PROCESSANDO há muito mais tempo
 * que isso não está processando coisa alguma — está morta. Derivar em vez de
 * marcar tem a vantagem de se corrigir sozinho: se a importação de fato
 * terminar, o status gravado muda e a dedução some junto.
 */

/**
 * Tempo além do qual uma importação em PROCESSANDO só pode estar morta.
 *
 * Folgado de propósito: o teto de execução das plataformas serverless fica
 * entre 1 e 5 minutos, então quinze minutos não produz falso positivo nem no
 * ambiente mais lento — e falso positivo aqui seria pior que o problema,
 * porque acusaria de morta uma importação que ainda vai terminar.
 */
export const MINUTOS_ATE_CONSIDERAR_INTERROMPIDA = 15;

export type EstadoImportacao =
  | "PENDENTE"
  | "PROCESSANDO"
  | "INTERROMPIDA"
  | "CONCLUIDA"
  | "CONCLUIDA_COM_ERROS"
  | "FALHA";

export function estadoDaImportacao(
  importacao: { status: string; iniciadoEm: Date },
  agora: Date = new Date(),
): EstadoImportacao {
  if (importacao.status !== "PROCESSANDO") return importacao.status as EstadoImportacao;

  const minutos = (agora.getTime() - importacao.iniciadoEm.getTime()) / 60_000;
  return minutos > MINUTOS_ATE_CONSIDERAR_INTERROMPIDA ? "INTERROMPIDA" : "PROCESSANDO";
}

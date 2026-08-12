import { falhaDominio, sucesso, type Resultado } from "@/shared/domain/resultado";

/**
 * Regras dos documentos de uma pessoa.
 *
 * A pessoa opera por até três documentos, e não é um limite arbitrário: é
 * exatamente a trilha de progressão. CPF como iniciante, um CNPJ ao virar
 * veterano, um segundo CNPJ ao virar expert. Um quarto documento não teria
 * degrau correspondente.
 *
 * Módulo puro: sem banco, sem I/O.
 */

export type TipoDocumento = "CPF" | "CNPJ";
export type Categoria = "INICIANTE" | "VETERANO" | "EXPERT";

export const MAX_CPF = 1;
export const MAX_CNPJ = 2;

export interface DocumentoDaPessoa {
  readonly id: string;
  readonly cpfCnpj: string;
  readonly tipo: TipoDocumento;
  readonly categoriaAtual: Categoria | null;
  readonly encerradoParaVendaEm: Date | null;
}

/** 11 dígitos é CPF, 14 é CNPJ. Qualquer outro tamanho é documento inválido. */
export function tipoDoDocumento(cpfCnpj: string): TipoDocumento | null {
  const digitos = cpfCnpj.replace(/\D/g, "");
  if (digitos.length === 11) return "CPF";
  if (digitos.length === 14) return "CNPJ";
  return null;
}

/**
 * Pode acrescentar mais um documento à pessoa?
 *
 * Devolve `Resultado` em vez de booleano porque o motivo importa: a tela
 * precisa dizer *por que* não pode, e "já tem CPF" é uma conversa diferente de
 * "já tem os dois CNPJs".
 */
export function podeAcrescentarDocumento(
  existentes: readonly DocumentoDaPessoa[],
  novoTipo: TipoDocumento,
): Resultado<true> {
  const cpfs = existentes.filter((doc) => doc.tipo === "CPF").length;
  const cnpjs = existentes.filter((doc) => doc.tipo === "CNPJ").length;

  if (novoTipo === "CPF" && cpfs >= MAX_CPF) {
    return falhaDominio(
      "PESSOA_JA_TEM_CPF",
      "Esta pessoa já tem um CPF vinculado. Uma pessoa física tem um CPF só — se o documento for de outra pessoa, o vínculo é que está errado.",
    );
  }

  if (novoTipo === "CNPJ" && cnpjs >= MAX_CNPJ) {
    return falhaDominio(
      "PESSOA_JA_TEM_DOIS_CNPJ",
      `Esta pessoa já tem ${MAX_CNPJ} CNPJs vinculados, o teto da trilha (veterano e expert). Um terceiro CNPJ não teria categoria correspondente.`,
    );
  }

  return sucesso(true);
}

/**
 * O documento pelo qual a pessoa vende hoje.
 *
 * Só um vende por vez. Ao ser promovida, a pessoa para de vender no documento
 * anterior — e o CNPJ de expert não vende: ele existe para receber o restante
 * da comissão das vendas feitas pelo CNPJ de veterano. Então o documento ativo
 * é o de maior categoria que ainda não foi encerrado, **exceto** o expert.
 */
export function documentoQueVende(
  documentos: readonly DocumentoDaPessoa[],
): DocumentoDaPessoa | null {
  const ordem: Record<Categoria, number> = { INICIANTE: 1, VETERANO: 2, EXPERT: 0 };

  const candidatos = documentos
    .filter((doc) => !doc.encerradoParaVendaEm)
    .filter((doc) => doc.categoriaAtual !== null && doc.categoriaAtual !== "EXPERT");

  if (candidatos.length === 0) return null;

  return candidatos.reduce((melhor, atual) =>
    ordem[atual.categoriaAtual as Categoria] > ordem[melhor.categoriaAtual as Categoria]
      ? atual
      : melhor,
  );
}

/**
 * Venda que chega num documento que não deveria mais vender.
 *
 * Não é para bloquear a importação — a administradora é a fonte da verdade e o
 * fato aconteceu. É para virar alerta: ou a promoção foi registrada com data
 * errada, ou a venda saiu pelo documento errado. Calcular em silêncio esconderia
 * as duas coisas.
 */
export function vendaEmDocumentoEncerrado(
  documento: Pick<DocumentoDaPessoa, "encerradoParaVendaEm">,
  dataVenda: Date,
): boolean {
  if (!documento.encerradoParaVendaEm) return false;
  return dataVenda.getTime() > documento.encerradoParaVendaEm.getTime();
}

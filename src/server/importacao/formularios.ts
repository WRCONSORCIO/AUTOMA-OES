/**
 * Códigos dos formulários da SERVOPA.
 *
 * Os três relatórios do fechamento têm cabeçalho quase idêntico — mesma
 * prestadora, mesmo CNPJ — e o que os distingue é este código. Subir um no
 * lugar do outro trocaria receita por repasse, então cada importador confere o
 * código antes de gravar qualquer coisa.
 */

export const FORMULARIOS = {
  /** Comissão que a administradora paga PARA a WR. */
  COMISSAO_WR: ["CV056E"],
  /** Comissão que a administradora paga DIRETO ao vendedor. */
  COMISSAO_VENDEDOR: ["CV069E", "VC069E"],
  /** Bônus de incentivo de vendas, pago à WR. */
  BONUS: ["GC070A"],
} as const;

/** Qualquer código no formato da administradora: duas letras, três dígitos, uma letra. */
export const PADRAO_FORMULARIO = /\b([A-Z]{2}\d{3}[A-Z])\b/;

export function lerFormulario(texto: string): string | null {
  return PADRAO_FORMULARIO.exec(texto)?.[1] ?? null;
}

/**
 * Recusa o arquivo quando o código lido não é um dos esperados.
 *
 * Só recusa quando conseguiu ler algum código: relatório sem código legível
 * segue adiante, porque bloquear por ausência impediria importações válidas
 * caso a administradora mude o cabeçalho.
 */
export function conferirFormulario(
  lido: string | null,
  aceitos: readonly string[],
  nomeDoRelatorio: string,
): void {
  if (!lido || aceitos.includes(lido)) return;

  throw new Error(
    `Este arquivo é o formulário ${lido}, e a importação de ${nomeDoRelatorio} espera ` +
      `${aceitos.join(" ou ")}. Confira se o relatório foi enviado na opção certa.`,
  );
}

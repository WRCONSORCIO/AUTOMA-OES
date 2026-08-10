import { resolverVigente, type ComVigencia } from "@/shared/domain/periodo";
import type { Categoria, TipoDocumento } from "./documentos";

/**
 * Progressão de categoria.
 *
 * A pessoa não escolhe categoria: ela progride ao atingir um volume vendido, e
 * cada degrau abre um documento novo.
 *
 *   CPF iniciante ──(meta 1)──▶ CNPJ veterano ──(meta 2)──▶ CNPJ expert
 *
 * As metas são **parâmetro com vigência**, nunca constante: mudar o valor da
 * meta não pode reclassificar retroativamente quem já foi promovido sob a meta
 * antiga.
 *
 * O acumulado é da **carteira completa** — todas as vendas da pessoa, somando
 * os documentos. Foi assim que a WR definiu, e é o que torna o consolidado da
 * pessoa um número de que o sistema depende.
 *
 * Módulo puro: sem banco, sem I/O.
 */

export interface MetaPromocao extends ComVigencia {
  readonly id: string;
  /** Categoria que a pessoa alcança ao cruzar o limite. */
  readonly categoriaAlvo: Exclude<Categoria, "INICIANTE">;
  /** Volume vendido acumulado, em reais, que dispara a promoção. */
  readonly volumeMinimo: number;
  /** Documento que o degrau exige abrir. */
  readonly abreDocumento: TipoDocumento;
}

export interface SituacaoPessoa {
  readonly pessoaId: string;
  readonly nome: string;
  /** Maior categoria já alcançada por qualquer documento da pessoa. */
  readonly categoriaAtual: Categoria | null;
  /** Vendido acumulado na carteira completa. */
  readonly volumeAcumulado: number;
  readonly documentosCnpj: number;
}

export interface AptidaoPromocao {
  readonly apto: boolean;
  readonly categoriaAlvo: Categoria | null;
  readonly volumeAcumulado: number;
  readonly volumeMinimo: number | null;
  /** Quanto falta. Zero ou negativo quando já cruzou. */
  readonly faltam: number;
  readonly motivo: string;
}

const ORDEM: Record<Categoria, number> = { INICIANTE: 0, VETERANO: 1, EXPERT: 2 };

/** O próximo degrau depois da categoria atual. */
export function proximoDegrau(atual: Categoria | null): Exclude<Categoria, "INICIANTE"> | null {
  if (atual === null || atual === "INICIANTE") return "VETERANO";
  if (atual === "VETERANO") return "EXPERT";
  return null;
}

/**
 * A pessoa está apta ao próximo degrau?
 *
 * Devolve sempre o motivo, inclusive quando não está: "faltam R$ X" é
 * informação de gestão tão útil quanto "está apto", e é o que alimenta o
 * acompanhamento no Dashboard.
 */
export function avaliarPromocao(
  pessoa: SituacaoPessoa,
  metas: readonly MetaPromocao[],
  em: Date,
): AptidaoPromocao {
  const alvo = proximoDegrau(pessoa.categoriaAtual);

  const semAlvo = (motivo: string): AptidaoPromocao => ({
    apto: false,
    categoriaAlvo: null,
    volumeAcumulado: pessoa.volumeAcumulado,
    volumeMinimo: null,
    faltam: 0,
    motivo,
  });

  if (!alvo) return semAlvo("Já é expert — não há degrau seguinte.");

  const meta = resolverVigente(
    metas.filter((m) => m.categoriaAlvo === alvo),
    em,
  );

  if (!meta) {
    return semAlvo(`Sem meta vigente cadastrada para ${alvo}.`);
  }

  const faltam = meta.volumeMinimo - pessoa.volumeAcumulado;

  if (faltam > 0) {
    return {
      apto: false,
      categoriaAlvo: alvo,
      volumeAcumulado: pessoa.volumeAcumulado,
      volumeMinimo: meta.volumeMinimo,
      faltam,
      motivo: `Faltam ${faltam.toFixed(2)} para atingir a meta de ${alvo}.`,
    };
  }

  return {
    apto: true,
    categoriaAlvo: alvo,
    volumeAcumulado: pessoa.volumeAcumulado,
    volumeMinimo: meta.volumeMinimo,
    faltam,
    motivo:
      `Atingiu ${pessoa.volumeAcumulado.toFixed(2)} na carteira completa, ` +
      `acima da meta de ${meta.volumeMinimo.toFixed(2)} para ${alvo}. ` +
      `Requer abrir um ${meta.abreDocumento}.`,
  };
}

/**
 * Categoria mais alta entre os documentos.
 *
 * É a categoria "da pessoa" para efeito de progressão — mas não para efeito de
 * cálculo: o dinheiro sempre olha a categoria congelada na venda, do documento
 * que vendeu.
 */
export function categoriaDaPessoa(
  categorias: readonly (Categoria | null)[],
): Categoria | null {
  let melhor: Categoria | null = null;
  for (const categoria of categorias) {
    if (!categoria) continue;
    if (melhor === null || ORDEM[categoria] > ORDEM[melhor]) melhor = categoria;
  }
  return melhor;
}

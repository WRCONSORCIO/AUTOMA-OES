import type { CategoriaVendedor, SegmentoVenda } from "@prisma/client";
import { inicioDoDiaUtc } from "./regras";

/**
 * Escolha da tabela de comissão que vale para uma venda.
 *
 * Duas dimensões decidem: a categoria do vendedor na data da venda e o segmento
 * do bem — imóvel e automóvel são negociados separadamente com a
 * administradora. A tabela sem segmento é o padrão, usada quando não existe uma
 * específica para o segmento da venda.
 *
 * A vigência é resolvida pela DATA DA VENDA, nunca por hoje: criar uma tabela
 * nova não pode reescrever o que já foi vendido sob a tabela antiga.
 */

export interface ComVigencia {
  categoria: CategoriaVendedor;
  segmento: SegmentoVenda | null;
  vigenteDe: Date;
  vigenteAte: Date | null;
}

function cobre(tabela: ComVigencia, data: Date): boolean {
  const dia = inicioDoDiaUtc(data).getTime();
  if (inicioDoDiaUtc(tabela.vigenteDe).getTime() > dia) return false;
  if (!tabela.vigenteAte) return true;
  return inicioDoDiaUtc(tabela.vigenteAte).getTime() >= dia;
}

/**
 * A tabela específica do segmento vence a genérica. Entre duas do mesmo tipo,
 * vence a de vigência mais recente.
 */
export function resolverPorVigencia<T extends ComVigencia>(
  tabelas: readonly T[],
  categoria: CategoriaVendedor,
  segmento: SegmentoVenda | null,
  data: Date,
): T | null {
  const candidatas = tabelas
    .filter((tabela) => tabela.categoria === categoria && cobre(tabela, data))
    .sort(
      (a, b) =>
        inicioDoDiaUtc(b.vigenteDe).getTime() - inicioDoDiaUtc(a.vigenteDe).getTime(),
    );

  if (segmento) {
    const especifica = candidatas.find((tabela) => tabela.segmento === segmento);
    if (especifica) return especifica;
  }

  return candidatas.find((tabela) => tabela.segmento === null) ?? null;
}

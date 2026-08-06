/**
 * Aritmética monetária.
 *
 * Todo valor circula como número de reais com duas casas. O banco guarda
 * `Decimal(18,2)`; aqui o cuidado é com o arredondamento e, principalmente, com
 * o rateio — que é onde o centavo some.
 *
 * Módulo puro: nenhuma dependência, nenhum acesso a banco.
 */

/**
 * Arredondamento comercial em 2 casas.
 *
 * `Math.round(x * 100) / 100` erra em casos como 1.005 → 1.00, porque
 * 1.005 * 100 vira 100.49999999999999 em ponto flutuante. A correção por
 * epsilon relativo (não absoluto) resolve mantendo a precisão em valores
 * grandes, onde um epsilon fixo seria pequeno demais para importar.
 */
export function arredondar(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  const escalado = valor * 100;
  const ajustado = Math.abs(escalado) + Number.EPSILON * Math.abs(escalado);
  return (Math.sign(escalado) * Math.round(ajustado)) / 100;
}

export function somar(...valores: readonly number[]): number {
  return arredondar(valores.reduce((total, valor) => total + (valor || 0), 0));
}

export function subtrair(a: number, b: number): number {
  return arredondar((a || 0) - (b || 0));
}

export function multiplicar(valor: number, fator: number): number {
  return arredondar((valor || 0) * (fator || 0));
}

/** Aplica um percentual expresso em pontos (10 = 10%). */
export function percentual(valor: number, pontos: number): number {
  return arredondar(((valor || 0) * (pontos || 0)) / 100);
}

/**
 * Percentual que `parte` representa de `total`, em pontos.
 * Total zero devolve zero em vez de infinito — divisão por zero em relatório
 * financeiro é sempre erro de dado, nunca informação.
 */
export function percentualEntre(parte: number, total: number): number {
  if (!total) return 0;
  return arredondar(((parte || 0) / total) * 100);
}

export function ehZero(valor: number): boolean {
  return Math.abs(arredondar(valor)) < 0.005;
}

// ---------------------------------------------------------------------------
// Rateio
// ---------------------------------------------------------------------------

export interface ParcelaRateio<T> {
  readonly item: T;
  readonly peso: number;
  readonly valor: number;
}

/**
 * Distribui um valor entre itens proporcionalmente ao peso de cada um,
 * **sem perder nem inventar centavos**.
 *
 * Arredondar cada parcela isoladamente quase sempre erra: R$ 100,00 em três
 * partes iguais vira 33,33 × 3 = 99,99, e some um centavo do fechamento. Aqui
 * a diferença acumulada é distribuída pelo método do maior resto — quem tem a
 * maior fração truncada recebe o centavo sobrando primeiro.
 *
 * Garantia: `soma(parcelas) === arredondar(valor)`, sempre.
 *
 * Peso total zero devolve todas as parcelas zeradas em vez de dividir por zero:
 * rateio de gerência sem venda alguma é zero, não erro.
 */
export function ratear<T>(
  valor: number,
  itens: readonly { item: T; peso: number }[],
): ParcelaRateio<T>[] {
  const alvo = arredondar(valor);
  const pesoTotal = itens.reduce((total, { peso }) => total + Math.max(0, peso || 0), 0);

  if (itens.length === 0) return [];
  if (pesoTotal <= 0) {
    return itens.map(({ item, peso }) => ({ item, peso, valor: 0 }));
  }

  // Trabalha em centavos inteiros: é onde a soma é exata.
  const centavosAlvo = Math.round(alvo * 100);

  const brutos = itens.map(({ item, peso }) => {
    const exato = (Math.max(0, peso || 0) / pesoTotal) * centavosAlvo;
    const piso = Math.trunc(exato);
    return { item, peso, piso, resto: exato - piso };
  });

  const distribuido = brutos.reduce((total, { piso }) => total + piso, 0);
  let sobra = centavosAlvo - distribuido;

  // Maior resto primeiro. O sinal da sobra acompanha o sinal do valor, então
  // estorno (negativo) distribui corretamente pelo mesmo caminho.
  const ordenados = [...brutos].sort((a, b) => b.resto - a.resto);
  const passo = sobra >= 0 ? 1 : -1;
  for (const bruto of ordenados) {
    if (sobra === 0) break;
    bruto.piso += passo;
    sobra -= passo;
  }

  return brutos.map(({ item, peso, piso }) => ({ item, peso, valor: piso / 100 }));
}

/** Rateio em partes iguais. Atalho para o caso mais comum. */
export function ratearIgualmente<T>(
  valor: number,
  itens: readonly T[],
): ParcelaRateio<T>[] {
  return ratear(
    valor,
    itens.map((item) => ({ item, peso: 1 })),
  );
}

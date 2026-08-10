/**
 * Vigência temporal.
 *
 * O sistema inteiro resolve regra **pela data do fato**, nunca por hoje. Criar
 * uma tabela nova não pode reescrever o que já foi vendido sob a tabela antiga,
 * e promover alguém hoje não pode mexer na comissão de uma venda de 2024.
 *
 * Toda alteração encerra o período anterior e abre um novo. Nada é
 * sobrescrito — é o que torna o histórico auditável.
 *
 * Módulo puro: nenhuma dependência, nenhum acesso a banco.
 */

export interface ComVigencia {
  readonly vigenteDe: Date;
  /** Nulo = em aberto, vigente até segunda ordem. */
  readonly vigenteAte: Date | null;
}

/**
 * Trunca para meia-noite UTC.
 *
 * Vigência é dia cheio: um período que começa em 01/03 vale desde o primeiro
 * instante de 01/03, independente do fuso de quem gravou. Comparar `Date`
 * bruto aqui produz o clássico "a regra só passou a valer às 21h".
 */
export function inicioDoDia(data: Date): Date {
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

/** O período cobre a data? Limites inclusivos nas duas pontas. */
export function cobre(periodo: ComVigencia, data: Date): boolean {
  const dia = inicioDoDia(data).getTime();
  if (inicioDoDia(periodo.vigenteDe).getTime() > dia) return false;
  if (!periodo.vigenteAte) return true;
  return inicioDoDia(periodo.vigenteAte).getTime() >= dia;
}

/**
 * O período vigente numa data.
 *
 * Havendo sobreposição, vence o de **início mais recente** que ainda cobre a
 * data. O histórico é append-only: correção entra como período novo, e o mais
 * recente é justamente a correção.
 */
export function resolverVigente<T extends ComVigencia>(
  periodos: readonly T[],
  data: Date,
): T | null {
  let escolhido: T | null = null;
  let melhorInicio = -Infinity;

  for (const periodo of periodos) {
    if (!cobre(periodo, data)) continue;
    const inicio = inicioDoDia(periodo.vigenteDe).getTime();
    if (inicio >= melhorInicio) {
      melhorInicio = inicio;
      escolhido = periodo;
    }
  }

  return escolhido;
}

/**
 * Resolve com precedência: o período **mais específico** vence o genérico.
 *
 * É o caso da regra de estorno (regra do vendedor vence a regra padrão da WR) e
 * da tabela de comissão (tabela do segmento vence a tabela geral). Entre dois
 * do mesmo nível de especificidade, decide a vigência mais recente.
 */
export function resolverVigentePorPrecedencia<T extends ComVigencia>(
  periodos: readonly T[],
  data: Date,
  ehEspecifico: (periodo: T) => boolean,
): T | null {
  const cobrindo = periodos.filter((periodo) => cobre(periodo, data));
  return (
    resolverVigente(cobrindo.filter(ehEspecifico), data) ??
    resolverVigente(
      cobrindo.filter((periodo) => !ehEspecifico(periodo)),
      data,
    )
  );
}

/**
 * Fecha o período aberto e devolve a data de encerramento a gravar: o dia
 * anterior ao início do novo período, para que não exista um dia coberto por
 * dois períodos.
 *
 * Devolve `null` quando o novo período começa no mesmo dia — o período anterior
 * durou zero dia e é substituído, não encerrado no dia anterior.
 */
export function encerramentoAnterior(inicioDoNovo: Date): Date | null {
  const inicio = inicioDoDia(inicioDoNovo);
  const anterior = new Date(inicio.getTime() - 24 * 60 * 60 * 1000);
  return anterior.getTime() < inicio.getTime() ? anterior : null;
}

/** Períodos que se sobrepõem, para validar antes de gravar. */
export function haSobreposicao(a: ComVigencia, b: ComVigencia): boolean {
  const inicioA = inicioDoDia(a.vigenteDe).getTime();
  const inicioB = inicioDoDia(b.vigenteDe).getTime();
  const fimA = a.vigenteAte ? inicioDoDia(a.vigenteAte).getTime() : Infinity;
  const fimB = b.vigenteAte ? inicioDoDia(b.vigenteAte).getTime() : Infinity;
  return inicioA <= fimB && inicioB <= fimA;
}

import { createHash } from "node:crypto";
import type { CategoriaVendedor, SegmentoVenda, TipoLancamentoComissao } from "@prisma/client";
import {
  normalizarContrato,
  normalizarCota,
  normalizarDocumento,
  normalizarGrupo,
  normalizarTexto,
} from "@/lib/normalize";

/**
 * Regras de negócio da WR Consórcio.
 *
 * Este módulo é intencionalmente puro (sem acesso a banco) para que cada regra
 * possa ser testada isoladamente e reutilizada tanto na importação quanto no
 * recálculo e na exibição.
 */

// ---------------------------------------------------------------------------
// Aritmética monetária
// ---------------------------------------------------------------------------

/**
 * Arredondamento comercial em 2 casas evitando o erro de ponto flutuante do
 * `Math.round(x * 100) / 100` (ex.: 1.005 → 1.00).
 */
export function arredondar2(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  const escalado = valor * 100;
  const arredondado = Math.sign(escalado) * Math.round(Math.abs(escalado) + Number.EPSILON * Math.abs(escalado));
  return arredondado / 100;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/** Trunca para meia-noite UTC — todas as comparações de vigência usam dia cheio. */
export function inicioDoDiaUtc(data: Date): Date {
  return new Date(
    Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()),
  );
}

function noIntervalo(data: Date, inicio: Date, fim: Date | null | undefined): boolean {
  const d = inicioDoDiaUtc(data).getTime();
  const i = inicioDoDiaUtc(inicio).getTime();
  if (d < i) return false;
  if (!fim) return true;
  return d <= inicioDoDiaUtc(fim).getTime();
}

// ---------------------------------------------------------------------------
// REGRA: a categoria pertence à venda, não ao vendedor
// ---------------------------------------------------------------------------

export interface PeriodoCategoria {
  categoria: CategoriaVendedor;
  vigenteDe: Date;
  vigenteAte: Date | null;
}

/**
 * Resolve a categoria vigente do vendedor NA DATA DA VENDA.
 *
 * A categoria resultante é gravada na venda e nunca mais recalculada: se o
 * vendedor mudar de categoria depois, as vendas anteriores continuam sendo
 * tratadas com a categoria que valia quando foram feitas.
 *
 * Quando há sobreposição de períodos, vence o de início mais recente que ainda
 * cobre a data — o histórico é append-only e correções entram como novo período.
 */
export function resolverCategoriaNaData(
  historico: readonly PeriodoCategoria[],
  dataVenda: Date,
): CategoriaVendedor | null {
  const candidatos = historico
    .filter((periodo) => noIntervalo(dataVenda, periodo.vigenteDe, periodo.vigenteAte))
    .sort(
      (a, b) => inicioDoDiaUtc(b.vigenteDe).getTime() - inicioDoDiaUtc(a.vigenteDe).getTime(),
    );

  return candidatos[0]?.categoria ?? null;
}

// ---------------------------------------------------------------------------
// REGRA: recuperação marca a venda permanentemente
// ---------------------------------------------------------------------------

export interface PeriodoRecuperacao {
  id: string;
  dataInicio: Date;
  dataFim: Date;
}

/**
 * Retorna o período de recuperação que cobre a data da venda, se houver.
 *
 * A marcação resultante é gravada na venda e é permanente: encerrar ou excluir
 * a recuperação depois não desmarca vendas já realizadas.
 */
export function encontrarRecuperacaoNaData(
  periodos: readonly PeriodoRecuperacao[],
  dataVenda: Date,
): PeriodoRecuperacao | null {
  const candidatos = periodos
    .filter((periodo) => noIntervalo(dataVenda, periodo.dataInicio, periodo.dataFim))
    .sort(
      (a, b) => inicioDoDiaUtc(a.dataInicio).getTime() - inicioDoDiaUtc(b.dataInicio).getTime(),
    );

  return candidatos[0] ?? null;
}

// ---------------------------------------------------------------------------
// REGRA: estorno
// ---------------------------------------------------------------------------

/** Parcela a partir da qual o cancelamento deixa de gerar estorno. */
export const PARCELA_LIMITE_ESTORNO = 6;

export interface EntradaEstorno {
  /** Marcação permanente de venda realizada durante recuperação. */
  emRecuperacao: boolean;
  /** Quantidade de parcelas pagas na data do cancelamento. */
  parcelasPagas: number;
  dataCancelamento: Date | null;
}

/**
 * Venda marcada em recuperação que cancela antes da sexta parcela gera estorno
 * — independente de o cancelamento ocorrer anos depois.
 */
export function deveGerarEstorno(entrada: EntradaEstorno): boolean {
  if (!entrada.emRecuperacao) return false;
  if (!entrada.dataCancelamento) return false;
  return entrada.parcelasPagas < PARCELA_LIMITE_ESTORNO;
}

// ---------------------------------------------------------------------------
// REGRA: inclusão de plano é sempre parcela 1
// ---------------------------------------------------------------------------

/**
 * Normaliza a parcela do lançamento do relatório.
 *
 * INCLUSAO DE PLANO nunca traz número de parcela no relatório e deve ser
 * sempre interpretada como parcela 1.
 */
export function resolverParcela(
  tipo: TipoLancamentoComissao,
  parcelaRelatorio: number | null | undefined,
): number {
  if (tipo === "INCLUSAO_DE_PLANO") return 1;
  if (parcelaRelatorio && parcelaRelatorio > 0) return parcelaRelatorio;
  return 1;
}

/** Converte o texto de origem do relatório no tipo de lançamento. */
export function identificarTipoLancamento(
  texto: string | null | undefined,
): TipoLancamentoComissao | null {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return null;
  if (normalizado.startsWith("INCLUSAO DE PLANO")) return "INCLUSAO_DE_PLANO";
  if (normalizado.startsWith("CANCELAMENTO DE PLANO")) return "CANCELAMENTO_DE_PLANO";
  if (normalizado.startsWith("PAGAMENTO COMISSAO")) return "PAGAMENTO_COMISSAO";
  return null;
}

// ---------------------------------------------------------------------------
// REGRA: flex define a base de cálculo
// ---------------------------------------------------------------------------

/**
 * Base de comissão = crédito × percentual da modalidade flex.
 * Ex.: crédito de 500.000 com Flex 50 resulta em base de 250.000.
 */
export function calcularBaseComissao(
  valorCredito: number,
  percentualFlex: number | null | undefined,
): number {
  const percentual =
    percentualFlex === null || percentualFlex === undefined || percentualFlex <= 0
      ? 100
      : percentualFlex;
  return arredondar2((valorCredito * percentual) / 100);
}

// ---------------------------------------------------------------------------
// REGRA: segmento do bem
// ---------------------------------------------------------------------------

/**
 * Segmento do bem a partir do texto que a administradora manda.
 *
 * A base traz `IMOVEL` / `MOVEL` na coluna de segmento; o relatório de comissão
 * traz o produto por extenso, "CREDITO P/IMOVEL 015" ou "CREDITO P/MOVEL 21".
 * O que a WR chama de automóvel é o que a administradora chama de móvel.
 *
 * Texto que não corresponda a nenhum dos dois devolve nulo: melhor cair na
 * tabela geral do que classificar errado.
 */
export function normalizarSegmento(
  valor: string | null | undefined,
): SegmentoVenda | null {
  if (!valor) return null;

  const texto = valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();

  // A ordem importa: "IMOVEL" contém "MOVEL".
  if (/\bI\s*MOVEL|P\/\s*IMOVEL|IMOVEL|IMOBILIARI/.test(texto)) return "IMOVEL";
  if (/\bMOVEL|P\/\s*MOVEL|AUTOMOVEL|AUTO\b|VEICULO/.test(texto)) return "AUTOMOVEL";

  return null;
}

// ---------------------------------------------------------------------------
// REGRA: o que a WR recebe da administradora
// ---------------------------------------------------------------------------

/** Faixa da tabela que define o REPASSE ao vendedor, parcela a parcela. */
export interface FaixaParcela {
  parcela: number;
  percentual: number;
}

export interface ResultadoComissaoWr {
  aplicavel: boolean;
  baseCalculo: number;
  percentual: number;
  valor: number;
  regra: string;
  observacao?: string;
}

export interface EntradaComissaoWr {
  /** Coluna VLR.COMISSAO do relatório. */
  valorComissao: number;
  /** Coluna VLR.DSR — descanso semanal remunerado, pago junto. */
  valorDsr: number | null;
  /** Coluna VLR.SEGURO — também entra no que a administradora paga. */
  valorSeguro: number | null;
  /** Percentual impresso no relatório, guardado para conferência. */
  percentualRelatorio: number | null;
  valorCredito: number;
  percentualFlex: number | null;
  tipo: TipoLancamentoComissao;
}

/**
 * O que a WR recebeu da administradora num lançamento.
 *
 * Não há cálculo a fazer: o valor é o que o relatório de fechamento manda, e a
 * administradora é a fonte da verdade sobre a própria dívida. A categoria do
 * vendedor não entra aqui — ela decide quanto a WR REPASSA ao vendedor, que é
 * o caminho inverso e vive nas tabelas de comissão da equipe.
 *
 * O recebido é a soma das TRÊS colunas de dinheiro: comissão, DSR e seguro. É
 * assim que o próprio relatório fecha — o "VLR. COMISSAO" do rodapé soma as
 * três, e é o número que a WR confere. O imposto de renda vem depois disso,
 * no total líquido, e não é abatido aqui: o que a WR tem a receber é o valor
 * cheio.
 *
 * O sinal vem pronto: cancelamento de plano chega negativo no relatório,
 * porque é devolução do que já havia sido pago.
 */
export function calcularComissaoWr(entrada: EntradaComissaoWr): ResultadoComissaoWr {
  const baseCalculo = calcularBaseComissao(entrada.valorCredito, entrada.percentualFlex);
  const valor = arredondar2(
    entrada.valorComissao + (entrada.valorDsr ?? 0) + (entrada.valorSeguro ?? 0),
  );

  // Percentual efetivo sobre a base, quando o relatório não traz o dele.
  const percentual =
    entrada.percentualRelatorio ??
    (baseCalculo > 0 ? arredondar2((valor / baseCalculo) * 100) : 0);

  return {
    aplicavel: true,
    baseCalculo,
    percentual,
    valor,
    regra:
      entrada.tipo === "CANCELAMENTO_DE_PLANO"
        ? "RELATORIO_ESTORNO"
        : "RELATORIO_ADMINISTRADORA",
  };
}

// ---------------------------------------------------------------------------
// REGRA: identidade e duplicidade da cota
// ---------------------------------------------------------------------------

export interface IdentidadeCota {
  administradoraId: string;
  contrato: string;
  grupo: string;
  cota: string;
  cpfCnpjCliente: string;
}

/**
 * Identidade da cota. Nunca use apenas CPF, apenas nome ou apenas contrato:
 * qualquer divergência no conjunto caracteriza outro registro.
 */
export function montarIdentidadeCota(entrada: {
  administradoraId: string;
  contrato: string | null | undefined;
  grupo: string | number | null | undefined;
  cota: string | number | null | undefined;
  cpfCnpjCliente: string | null | undefined;
}): IdentidadeCota {
  return {
    administradoraId: entrada.administradoraId,
    contrato: normalizarContrato(entrada.contrato),
    grupo: normalizarGrupo(entrada.grupo),
    cota: normalizarCota(entrada.cota),
    cpfCnpjCliente: normalizarDocumento(entrada.cpfCnpjCliente),
  };
}

export function chaveIdentidadeCota(identidade: IdentidadeCota): string {
  return [
    identidade.administradoraId,
    identidade.contrato,
    identidade.grupo,
    identidade.cota,
    identidade.cpfCnpjCliente,
  ].join("|");
}

export interface ChaveDuplicidade {
  administradoraId: string;
  contrato: string | null | undefined;
  grupo: string | number | null | undefined;
  cota: string | number | null | undefined;
  cpfCnpjCliente: string | null | undefined;
  nomeCliente: string | null | undefined;
  cpfCnpjVendedor: string | null | undefined;
}

/**
 * Duplicidade só existe quando TODOS os sete campos coincidem. Divergência em
 * qualquer um deles caracteriza outro registro, não uma duplicata.
 */
export function chaveDuplicidade(entrada: ChaveDuplicidade): string {
  return [
    entrada.administradoraId,
    normalizarContrato(entrada.contrato),
    normalizarGrupo(entrada.grupo),
    normalizarCota(entrada.cota),
    normalizarDocumento(entrada.cpfCnpjCliente),
    normalizarTexto(entrada.nomeCliente),
    normalizarDocumento(entrada.cpfCnpjVendedor),
  ].join("|");
}

export function saoDuplicados(a: ChaveDuplicidade, b: ChaveDuplicidade): boolean {
  return chaveDuplicidade(a) === chaveDuplicidade(b);
}

// ---------------------------------------------------------------------------
// Hashes de conteúdo (detecção de alteração e idempotência de importação)
// ---------------------------------------------------------------------------

export function hashConteudo(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

// ---------------------------------------------------------------------------
// REGRA: precedência do vendedor
// ---------------------------------------------------------------------------

export interface ResolucaoVendedor {
  vendedorId: string | null;
  origem: "OVERRIDE_WR" | "ADMINISTRADORA" | "NAO_IDENTIFICADO";
}

/**
 * O vendedor efetivo é sempre o override interno da WR quando existir.
 * Sem override, vale o vendedor informado pela administradora.
 */
export function resolverVendedorEfetivo(entrada: {
  vendedorOverrideId: string | null | undefined;
  vendedorAdministradoraId: string | null | undefined;
}): ResolucaoVendedor {
  if (entrada.vendedorOverrideId) {
    return { vendedorId: entrada.vendedorOverrideId, origem: "OVERRIDE_WR" };
  }
  if (entrada.vendedorAdministradoraId) {
    return { vendedorId: entrada.vendedorAdministradoraId, origem: "ADMINISTRADORA" };
  }
  return { vendedorId: null, origem: "NAO_IDENTIFICADO" };
}

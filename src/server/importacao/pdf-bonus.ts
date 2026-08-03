import "server-only";

import { normalizarCota, normalizarGrupo, parseDataBr, parseValorBr } from "@/lib/normalize";
import { normalizarSegmento } from "@/server/domain/regras";
import { extrairLinhas } from "./pdf-comissao";
import { lerFormulario } from "./formularios";
import type { SegmentoVenda } from "@prisma/client";

/**
 * Leitor do relatório de incentivo de vendas (SERVOPA — formulário GC070A).
 *
 * É o bônus que a administradora paga à WR, e não é repassado a ninguém. O
 * relatório não traz vendedor: quem responde por cada linha é a cota, e o
 * rateio por gerência sai do cruzamento com a base — feito na importação.
 *
 * Cada lançamento cabe numa linha só, diferente do relatório de comissão, em
 * que um registro ocupa três. Por isso aqui a leitura é por expressão regular
 * sobre a linha reconstruída, e não por faixas de coluna.
 */

export interface RegistroBonusPdf {
  grupo: string;
  cota: string;
  contrato: string;
  nomeConsorciado: string;
  tipoPessoa: string;
  parcela: number | null;
  dataInclusao: Date | null;
  valorEvento: number;
  percentualIncentivo: number | null;
  valorIncentivo: number;
  percentualFlex: number | null;
  segmento: SegmentoVenda | null;
  pagina: number;
}

export interface ErroBonusPdf {
  pagina: number;
  mensagem: string;
  conteudo: string;
}

export interface ResultadoLeituraBonus {
  registros: RegistroBonusPdf[];
  erros: ErroBonusPdf[];
  paginas: number;
  periodoInicio: Date | null;
  periodoFim: Date | null;
  dataEmissao: Date | null;
  formulario: string | null;
  prestadora: string | null;
  /** Total impresso no rodapé, usado para conferir a leitura. */
  totalRelatorio: number | null;
  totalLiquido: number | null;
  somaLida: number;
  divergencia: number | null;
}

/**
 * `1533.0106-7` — grupo, cota e dígito. O dígito não entra na identidade: a
 * base guarda grupo e cota separados, sem ele.
 */
const LINHA_REGISTRO =
  /^\s*(\d{3,5})\.(\d{3,5})-(\d)\s+(\S+)\s+(.+?)\s+([A-Z])\s+(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d{2}))?\s*$/;

const SEGMENTO = /^\s*SEGMENTO:\s*(.+?)\s*$/;
const PERIODO = /PERIODO\s+APURACAO:\s*(\d{2}\/\d{2}\/\d{4})\s+A\s+(\d{2}\/\d{2}\/\d{4})/;
const EMISSAO = /EMISSAO:\s*(\d{2}\/\d{2}\/\d{4})/;
const PRESTADORA = /^\s*PRESTADORA:\s*\S+\s+(.+?)\s{2,}CPF\/CNPJ/;
const TOTAL_COMISSAO = /VLR\.\s*COMISSAO:\s*([\d.]+,\d{2})/;
const TOTAL_LIQUIDO = /TOTAL\s+LIQUIDO:\s*([\d.]+,\d{2})/;

/** O relatório escreve o segmento espaçado: "I M O V E L". */
function juntarLetras(valor: string): string {
  return valor.replace(/\s+/g, "");
}

export async function lerPdfBonus(arquivo: Buffer): Promise<ResultadoLeituraBonus> {
  const { brutas, paginas } = await extrairLinhas(arquivo);

  const registros: RegistroBonusPdf[] = [];
  const erros: ErroBonusPdf[] = [];

  let segmentoAtual: SegmentoVenda | null = null;
  let periodoInicio: Date | null = null;
  let periodoFim: Date | null = null;
  let dataEmissao: Date | null = null;
  let prestadora: string | null = null;
  let formulario: string | null = null;
  let totalRelatorio: number | null = null;
  let totalLiquido: number | null = null;

  for (const linha of brutas) {
    const texto = linha.texto;

    if (!formulario) formulario = lerFormulario(texto);

    const segmento = SEGMENTO.exec(texto);
    if (segmento) {
      segmentoAtual = normalizarSegmento(juntarLetras(segmento[1]!));
      continue;
    }

    if (!periodoInicio) {
      const periodo = PERIODO.exec(texto);
      if (periodo) {
        periodoInicio = parseDataBr(periodo[1]!);
        periodoFim = parseDataBr(periodo[2]!);
      }
    }

    if (!dataEmissao) {
      const emissao = EMISSAO.exec(texto);
      if (emissao) dataEmissao = parseDataBr(emissao[1]!);
    }

    if (!prestadora) {
      const achado = PRESTADORA.exec(texto);
      if (achado) prestadora = achado[1]!.trim();
    }

    const totalC = TOTAL_COMISSAO.exec(texto);
    if (totalC) totalRelatorio = parseValorBr(totalC[1]!);

    const totalL = TOTAL_LIQUIDO.exec(texto);
    if (totalL) totalLiquido = parseValorBr(totalL[1]!);

    const registro = LINHA_REGISTRO.exec(texto);
    if (!registro) continue;

    const valorEvento = parseValorBr(registro[9]!);
    const valorIncentivo = parseValorBr(registro[11]!);

    if (valorIncentivo === null || valorEvento === null) {
      erros.push({
        pagina: linha.pagina,
        mensagem: "Valores do incentivo não puderam ser lidos.",
        conteudo: texto,
      });
      continue;
    }

    registros.push({
      grupo: normalizarGrupo(registro[1]!),
      // O dígito verificador vem separado no relatório; a base guarda "106-7".
      cota: normalizarCota(`${registro[2]}-${registro[3]}`),
      contrato: registro[4]!.trim(),
      nomeConsorciado: registro[5]!.trim(),
      tipoPessoa: registro[6]!,
      parcela: Number(registro[7]) || null,
      dataInclusao: parseDataBr(registro[8]!),
      valorEvento,
      percentualIncentivo: parseValorBr(registro[10]!),
      valorIncentivo,
      percentualFlex: registro[12] ? parseValorBr(registro[12]) : null,
      segmento: segmentoAtual,
      pagina: linha.pagina,
    });
  }

  const somaLida = Math.round(
    registros.reduce((total, item) => total + item.valorIncentivo, 0) * 100,
  ) / 100;

  return {
    registros,
    erros,
    paginas,
    periodoInicio,
    periodoFim,
    dataEmissao,
    formulario,
    prestadora,
    totalRelatorio,
    totalLiquido,
    somaLida,
    divergencia:
      totalRelatorio === null ? null : Math.round((somaLida - totalRelatorio) * 100) / 100,
  };
}

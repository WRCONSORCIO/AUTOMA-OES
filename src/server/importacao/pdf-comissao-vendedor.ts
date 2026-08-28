import {
  normalizarCota,
  normalizarDocumento,
  normalizarGrupo,
  parseDataBr,
  parseValorBr,
} from "@/lib/normalize";
import { extrairLinhas } from "./pdf-comissao";
import { lerFormulario } from "./formularios";

/**
 * Leitor do relatório de comissão dos vendedores (SERVOPA — formulário CV069E,
 * também emitido como VC069E, "REL COMISSAO Y VENDEDOR").
 *
 * É o que a administradora paga DIRETO ao vendedor — categorias veterano e
 * expert. A WR não paga nada dessas vendas; o relatório entra no sistema para
 * a WR enxergar quanto cada um recebeu, e conferir contra o próprio fechamento.
 *
 * Não confundir com o CV056E, que tem cabeçalho quase igual e a mesma
 * prestadora (WRCON nos dois). O que separa é o formulário, e é por ele que a
 * importação decide de quem é o dinheiro.
 *
 * Cada lançamento ocupa três linhas:
 *
 *     1566.1053 -1   E MARIANA DAS GRACAS SILVA SOUZA        / 31 97338.7112
 *         37966I10                          103.312,00  50,00    51,66   0,00  0,00  0,1000
 *                   3   22/07/2026                          01/05/2026     I
 */

export interface RegistroComissaoVendedorPdf {
  vendedorDocumento: string;
  vendedorNome: string;
  grupo: string;
  cota: string;
  contrato: string;
  nomeCliente: string;
  objeto: string | null;
  valorCredito: number;
  percentualFlex: number | null;
  valorComissao: number;
  valorDsr: number | null;
  valorSeguro: number | null;
  percentualComissao: number | null;
  parcela: number | null;
  dataPagamento: Date | null;
  dataVenda: Date | null;
  pagina: number;
}

export interface ResultadoLeituraComissaoVendedor {
  registros: RegistroComissaoVendedorPdf[];
  erros: { pagina: number; mensagem: string; conteudo: string }[];
  paginas: number;
  dataEmissao: Date | null;
  formulario: string | null;
  /** Total por vendedor impresso no relatório, para conferir a leitura. */
  totaisPorVendedor: Map<string, number>;
  totalRelatorio: number | null;
  totalLiquido: number | null;
  somaLida: number;
  divergencia: number | null;
}

const EMISSAO = /EMISSAO:\s*(\d{2}\/\d{2}\/\d{4})/;

/** `VENDEDOR (CPF/CNPJ): 35.666.540/0001-93 - 35.666.540 ELZENI DE PAIVA FERREIRA` */
const CABECALHO_VENDEDOR =
  /^\s*VENDEDOR\s*\(CPF\/CNPJ\):\s*([\d.\-/]+)\s*-\s*(.+?)\s*$/;

/** Linha 1: cota, indicador, nome do cliente e contato. */
const LINHA_COTA =
  /^\s*(\d{3,5})\.(\d{3,5})\s*-\s*(\d)\s+[A-Z](?:\s+[A-Z])?\s+(.+?)(?:\s{2,}.*)?$/;

/** Linha 2: contrato, objeto e os valores. */
const LINHA_VALORES =
  /^\s*(\S+)\s+(.*?)\s{2,}([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+(-?[\d.]+,\d{2})-?\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{4})\s*$/;

/**
 * Linha 3: parcela (ausente na inclusão de plano) e as datas.
 *
 * A última coluna é a classificação do objeto, e ela NÃO é sempre uma letra:
 * imóvel vem como `I`, móvel vem como dígito. Exigir letra fazia a linha não
 * casar, e como é ela que fecha o registro — as três linhas só viram um
 * lançamento quando a terceira chega —, o lançamento inteiro era descartado em
 * silêncio. O efeito era todo o segmento de móveis sumir do relatório, e a
 * única pista era a divergência contra o total impresso.
 */
const LINHA_DATAS =
  /^\s*(\d{1,3})?\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}\/\d{2}\/\d{4}))?(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*([A-Z0-9])?\s*$/;

const TOTAL_VENDEDOR = /Total\s+do\s+Vendedor\s*\.*:\s*(-?[\d.]+,\d{2})/i;
const TOTAL_COMISSAO = /VLR\.\s*COMISSAO:\s*(-?[\d.]+,\d{2})/;
const TOTAL_LIQUIDO = /TOTAL\s+LIQUIDO:\s*(-?[\d.]+,\d{2})/;

/** Linhas de cabeçalho e rodapé que se repetem a cada página. */
const RUIDO: readonly RegExp[] = [
  /^\s*SERVOPA\s+ADMINISTRADORA/i,
  /^\s*ATIVIDADE\s*:/i,
  /^\s*SOLICITANTE\s*:/i,
  /^\s*PRESTADORA\s*:/i,
  /^\s*COTA\s+D\s*E\s+NOME/i,
  /^\s*ORIGEM\b/i,
  /^\s*[-\s]+$/,
  /^\s*Sub-Total/i,
  /VLR\.\s*BENS/i,
  /^\s*I\.R\./i,
  /RELATORIO\s+PARA\s+ACOMPANHAMENTO/i,
  /NAO\s+EMITIR\s+NOTA\s+FISCAL/i,
  /^\s*DOS\s+VENDEDORES/i,
];

function ehRuido(texto: string): boolean {
  return RUIDO.some((padrao) => padrao.test(texto));
}

export async function lerPdfComissaoVendedor(
  arquivo: Buffer,
): Promise<ResultadoLeituraComissaoVendedor> {
  const { brutas, paginas } = await extrairLinhas(arquivo);
  return interpretarLinhas(brutas, paginas);
}

/**
 * Interpreta as linhas já reconstruídas.
 *
 * Separado da leitura do PDF para poder ser exercitado com o texto exato do
 * relatório, sem depender de um arquivo.
 */
export function interpretarLinhas(
  brutas: readonly { pagina: number; texto: string }[],
  paginas: number,
): ResultadoLeituraComissaoVendedor {
  const registros: RegistroComissaoVendedorPdf[] = [];
  const erros: { pagina: number; mensagem: string; conteudo: string }[] = [];
  const totaisPorVendedor = new Map<string, number>();

  let formulario: string | null = null;
  let dataEmissao: Date | null = null;
  let totalRelatorio: number | null = null;
  let totalLiquido: number | null = null;

  let vendedorDocumento = "";
  let vendedorNome = "";

  // O registro ocupa três linhas; estas duas guardam as anteriores.
  let cotaPendente: { grupo: string; cota: string; nomeCliente: string; pagina: number } | null =
    null;
  let valoresPendentes: Omit<
    RegistroComissaoVendedorPdf,
    "vendedorDocumento" | "vendedorNome" | "grupo" | "cota" | "nomeCliente" | "parcela" | "dataPagamento" | "dataVenda" | "pagina"
  > | null = null;

  const fechar = (parcela: number | null, pagamento: Date | null, venda: Date | null) => {
    if (!cotaPendente || !valoresPendentes) return;

    registros.push({
      vendedorDocumento,
      vendedorNome,
      grupo: cotaPendente.grupo,
      cota: cotaPendente.cota,
      nomeCliente: cotaPendente.nomeCliente,
      parcela,
      dataPagamento: pagamento,
      dataVenda: venda,
      pagina: cotaPendente.pagina,
      ...valoresPendentes,
    });

    cotaPendente = null;
    valoresPendentes = null;
  };

  for (const linha of brutas) {
    const texto = linha.texto;

    if (!formulario) formulario = lerFormulario(texto);
    if (!dataEmissao) {
      const achado = EMISSAO.exec(texto);
      if (achado) dataEmissao = parseDataBr(achado[1]!);
    }

    const totalV = TOTAL_VENDEDOR.exec(texto);
    if (totalV) {
      const valor = parseValorBr(totalV[1]!);
      if (valor !== null && vendedorDocumento) {
        totaisPorVendedor.set(vendedorDocumento, valor);
      }
      continue;
    }

    const totalC = TOTAL_COMISSAO.exec(texto);
    if (totalC) {
      totalRelatorio = parseValorBr(totalC[1]!);
      continue;
    }

    const totalL = TOTAL_LIQUIDO.exec(texto);
    if (totalL) {
      totalLiquido = parseValorBr(totalL[1]!);
      continue;
    }

    const cabecalho = CABECALHO_VENDEDOR.exec(texto);
    if (cabecalho) {
      vendedorDocumento = normalizarDocumento(cabecalho[1]!);
      // A razão social vem às vezes prefixada pela raiz do CNPJ.
      vendedorNome = cabecalho[2]!.replace(/^\s*[\d.]+\s+/, "").trim();
      continue;
    }

    if (ehRuido(texto)) continue;

    const cota = LINHA_COTA.exec(texto);
    if (cota) {
      cotaPendente = {
        grupo: normalizarGrupo(cota[1]!),
        cota: normalizarCota(`${cota[2]}-${cota[3]}`),
        nomeCliente: cota[4]!.trim(),
        pagina: linha.pagina,
      };
      valoresPendentes = null;
      continue;
    }

    const valores = LINHA_VALORES.exec(texto);
    if (valores && cotaPendente) {
      const valorComissao = parseValorBr(valores[5]!);
      const valorCredito = parseValorBr(valores[3]!);

      if (valorComissao === null || valorCredito === null) {
        erros.push({
          pagina: linha.pagina,
          mensagem: "Valores do lançamento não puderam ser lidos.",
          conteudo: texto,
        });
        cotaPendente = null;
        continue;
      }

      valoresPendentes = {
        contrato: valores[1]!.trim(),
        objeto: valores[2]!.trim() || null,
        valorCredito,
        percentualFlex: parseValorBr(valores[4]!),
        valorComissao,
        valorDsr: parseValorBr(valores[6]!),
        valorSeguro: parseValorBr(valores[7]!),
        percentualComissao: parseValorBr(valores[8]!),
      };
      continue;
    }

    const datas = LINHA_DATAS.exec(texto);
    if (datas && cotaPendente && valoresPendentes) {
      // Sem parcela impressa é inclusão de plano, que é sempre a primeira.
      const parcela = datas[1] ? Number(datas[1]) : 1;
      // A última data da linha é a da venda; as do meio são contábil e cheque.
      const datasLidas = [datas[2], datas[3], datas[4]].filter(Boolean) as string[];
      const pagamento = parseDataBr(datasLidas[0] ?? "");
      const venda = parseDataBr(datasLidas.at(-1) ?? "");

      fechar(parcela, pagamento, datasLidas.length > 1 ? venda : null);
    }
  }

  const somaLida =
    Math.round(registros.reduce((total, item) => total + item.valorComissao, 0) * 100) / 100;

  const somaDosTotais =
    Math.round([...totaisPorVendedor.values()].reduce((a, b) => a + b, 0) * 100) / 100;

  // Confere contra o total do relatório quando ele existe; senão, contra a soma
  // dos totais por vendedor, que o relatório imprime de qualquer forma.
  const referencia = totalRelatorio ?? (totaisPorVendedor.size > 0 ? somaDosTotais : null);

  return {
    registros,
    erros,
    paginas,
    dataEmissao,
    formulario,
    totaisPorVendedor,
    totalRelatorio,
    totalLiquido,
    somaLida,
    divergencia: referencia === null ? null : Math.round((somaLida - referencia) * 100) / 100,
  };
}

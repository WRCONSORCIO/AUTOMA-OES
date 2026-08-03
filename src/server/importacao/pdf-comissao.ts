import type { TipoLancamentoComissao } from "@prisma/client";
import { lerFormulario } from "./formularios";
import {
  limparNomeVendedor,
  normalizarContrato,
  normalizarCota,
  normalizarDocumento,
  normalizarGrupo,
  parseDataBr,
  parseValorBr,
} from "@/lib/normalize";
import { identificarTipoLancamento, resolverParcela } from "@/server/domain/regras";

/**
 * Leitor do relatório de fechamento de comissão (SERVOPA — formulário CV056E).
 *
 * O relatório é um listado de largura fixa em fonte monoespaçada. Em vez de
 * interpretar o texto corrido — que embaralha valores quando o extrator quebra
 * tokens — reconstruímos cada linha na coluna original a partir das coordenadas
 * dos glifos e recortamos os campos pelas faixas declaradas no cabeçalho do
 * próprio relatório.
 *
 * Cada registro ocupa três linhas consecutivas:
 *   1) contrato, indicador D/E, nome do cliente e contato
 *   2) grupo.cota.dígito, objeto e valores numéricos
 *   3) origem (tipo do lançamento), parcela e datas
 *
 * As três linhas podem ficar separadas por uma quebra de página, por isso o
 * documento é tratado como um fluxo contínuo com os cabeçalhos removidos.
 */

export interface RegistroComissaoPdf {
  ordem: number;
  pagina: number;
  cpfCnpjVendedor: string;
  nomeVendedor: string;
  contrato: string;
  grupo: string;
  cota: string;
  nomeCliente: string;
  contatoCliente: string | null;
  objeto: string | null;
  indicador: string | null;
  valorCredito: number;
  percentualFlex: number | null;
  valorComissao: number;
  valorDsr: number | null;
  valorSeguro: number | null;
  percentualComissao: number | null;
  tipo: TipoLancamentoComissao;
  tipoOriginal: string;
  parcela: number;
  dataPagamento: Date | null;
  dataContabil: Date | null;
  dataCheque: Date | null;
  dataVenda: Date | null;
  classificacaoObjeto: string | null;
  assinatura: string | null;
}

export interface ErroPdf {
  pagina: number;
  mensagem: string;
  conteudo: string;
}

export interface TotaisRelatorio {
  bensImoveis: number | null;
  bensMoveis: number | null;
  comissao: number | null;
  impostoRenda: number | null;
  liquido: number | null;
}

export interface ResultadoLeituraPdf {
  /** Código do formulário lido no cabeçalho, usado para recusar arquivo trocado. */
  formulario: string | null;
  registros: RegistroComissaoPdf[];
  erros: ErroPdf[];
  paginas: number;
  dataEmissao: Date | null;
  administradora: string | null;
  totais: TotaisRelatorio;
  somaComissaoLida: number;
  somaSeguroLida: number;
  /** Diferença entre o total impresso no relatório e a soma dos registros lidos. */
  divergencia: number | null;
}

type Faixa = readonly [number, number];

export interface ItemTexto {
  str: string;
  transform: number[];
  width: number;
}

interface FaixasValores {
  credito: Faixa;
  flex: Faixa;
  comissao: Faixa;
  dsr: Faixa;
  seguro: Faixa;
  percentual: Faixa;
}

/** Faixas de referência do layout CV056E, usadas quando o cabeçalho não é lido. */
const FAIXAS_PADRAO: FaixasValores = {
  credito: [53, 79],
  flex: [79, 86],
  comissao: [86, 103],
  dsr: [103, 115],
  seguro: [115, 127],
  percentual: [127, 141],
};

/** Faixas de coluna da linha de origem/parcela/datas. */
const FAIXAS_ORIGEM = {
  origem: [5, 43],
  parcela: [43, 47],
  dataPagamento: [47, 60],
  dataContabil: [60, 72],
  dataCheque: [72, 84],
  dataVenda: [84, 100],
  classificacao: [100, 110],
  assinatura: [110, 130],
} as const;

const RE_VENDEDOR = /^\s*VENDEDOR\s*\(CPF\/CNPJ\):\s*(\S+)\s*-\s*(.+?)\s*$/;
const RE_LINHA_VALORES = /^\s{2,6}(\d{3,5})\.(\d{3,5})\.(\d)\s/;
const RE_LINHA_CLIENTE = /^\s{2,6}(\S+)\s+([DE])\s+(\S.*)$/;
const RE_EMISSAO = /EMISSAO:\s*(\d{2}\/\d{2}\/\d{4})/;
const RE_CABECALHO_VALORES = /^\s*COTA\s+OBJETO\s+VL\.CREDITO/;

/** Linhas de cabeçalho, rodapé e separadores que se repetem a cada página. */
const RUIDO: readonly RegExp[] = [
  /PAGINA:\s*\d+\s*$/,
  /^\s*ATIVIDADE\s*:/,
  /^\s*SOLICITANTE\s*:/,
  /^\s*PRESTADORA\s*:/,
  /^\s*CONTRATO\s+D\s+E\s+NOME DO CLIENTE/,
  RE_CABECALHO_VALORES,
  /^\s*ORIGEM\s+PARC\s+DT\s+PAGAM/,
  /^[\s\-]*$/,
  /Total do Vendedor/,
  /^\s*VLR\.\s*(BENS|COMISSAO)/,
  /^\s*I\.R\./,
  /^\s*TOTAL LIQUIDO/,
];

function ehRuido(linha: string): boolean {
  return RUIDO.some((padrao) => padrao.test(linha));
}

function recortar(linha: string, faixa: Faixa): string {
  return linha.slice(faixa[0], faixa[1]).trim();
}

/**
 * Deriva as faixas numéricas a partir do cabeçalho impresso. Os valores são
 * alinhados à direita pelo fim do rótulo; a folga de duas colunas acomoda o
 * sufixo "-" que a administradora usa para indicar valor negativo.
 */
function derivarFaixas(cabecalho: string | null): FaixasValores {
  if (!cabecalho) return FAIXAS_PADRAO;

  const rotulos = [
    ["credito", "VL.CREDITO"],
    ["flex", "%FLEX"],
    ["comissao", "VLR.COMISSAO"],
    ["dsr", "VLR.DSR"],
    ["seguro", "VLR.SEGURO"],
    ["percentual", "(%)"],
  ] as const;

  const limites: { chave: keyof FaixasValores; inicio: number; fim: number }[] = [];
  for (const [chave, rotulo] of rotulos) {
    const indice = cabecalho.indexOf(rotulo);
    if (indice < 0) return FAIXAS_PADRAO;
    limites.push({ chave, inicio: indice, fim: indice + rotulo.length + 2 });
  }

  const faixas = {} as Record<keyof FaixasValores, Faixa>;
  for (let i = 0; i < limites.length; i += 1) {
    const atual = limites[i]!;
    // O crédito é o primeiro valor: abre espaço à esquerda para números longos.
    const esquerda = i === 0 ? Math.max(0, atual.inicio - 14) : limites[i - 1]!.fim;
    faixas[atual.chave] = [esquerda, atual.fim];
  }
  return faixas as FaixasValores;
}

interface LinhaDocumento {
  pagina: number;
  texto: string;
}

export async function extrairLinhas(
  arquivo: Buffer,
): Promise<{ linhas: LinhaDocumento[]; brutas: LinhaDocumento[]; paginas: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(arquivo),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const linhas: LinhaDocumento[] = [];
  const brutas: LinhaDocumento[] = [];

  for (let numero = 1; numero <= documento.numPages; numero += 1) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();
    // `items` mistura trechos de texto e marcações estruturais; só os
    // primeiros carregam posição e conteúdo.
    const itens: ItemTexto[] = [];
    for (const item of conteudo.items) {
      if ("str" in item && Array.isArray(item.transform)) {
        itens.push({ str: item.str, transform: item.transform, width: item.width });
      }
    }

    for (const texto of reconstruirLinhas(itens)) {
      brutas.push({ pagina: numero, texto });
      if (!ehRuido(texto)) linhas.push({ pagina: numero, texto });
    }
  }

  await documento.destroy();
  return { linhas, brutas, paginas: documento.numPages };
}

/**
 * Reconstrói as linhas da página preservando a coluna original de cada token.
 * A largura do caractere é medida na própria página, o que dispensa constantes
 * dependentes da fonte.
 */
export function reconstruirLinhas(itens: readonly ItemTexto[]): string[] {
  let somaLarguras = 0;
  let amostras = 0;
  for (const item of itens) {
    if (item.str.length > 1 && item.width > 0) {
      somaLarguras += item.width / item.str.length;
      amostras += 1;
    }
  }
  const larguraChar = amostras > 0 ? somaLarguras / amostras : 4.286;

  const porLinha = new Map<number, { coluna: number; texto: string }[]>();
  for (const item of itens) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5] ?? 0);
    const coluna = Math.round((item.transform[4] ?? 0) / larguraChar);
    const grupo = porLinha.get(y);
    if (grupo) grupo.push({ coluna, texto: item.str });
    else porLinha.set(y, [{ coluna, texto: item.str }]);
  }

  return [...porLinha.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, partes]) => {
      partes.sort((a, b) => a.coluna - b.coluna);
      let linha = "";
      for (const parte of partes) {
        if (linha.length < parte.coluna) linha = linha.padEnd(parte.coluna, " ");
        linha =
          linha.slice(0, parte.coluna) +
          parte.texto +
          linha.slice(parte.coluna + parte.texto.length);
      }
      return linha.replace(/\s+$/, "");
    });
}

export async function lerPdfComissao(arquivo: Buffer): Promise<ResultadoLeituraPdf> {
  const { linhas, brutas, paginas } = await extrairLinhas(arquivo);

  // O código do formulário identifica o relatório: os três do fechamento têm
  // cabeçalho quase igual, e subir um no lugar do outro trocaria receita por
  // repasse.
  let formulario: string | null = null;
  for (const linha of brutas) {
    formulario = lerFormulario(linha.texto);
    if (formulario) break;
  }

  const cabecalhoValores =
    brutas.find((linha) => RE_CABECALHO_VALORES.test(linha.texto))?.texto ?? null;
  const faixas = derivarFaixas(cabecalhoValores);

  const registros: RegistroComissaoPdf[] = [];
  const erros: ErroPdf[] = [];

  let dataEmissao: Date | null = null;
  let administradora: string | null = null;

  for (const { texto } of brutas) {
    if (!dataEmissao) {
      const emissao = texto.match(RE_EMISSAO);
      if (emissao) dataEmissao = parseDataBr(emissao[1]);
    }
    if (!administradora && /ADMINISTRADORA DE CONSORCIOS/i.test(texto)) {
      administradora = texto.trim().split(/\s{2,}/)[0]?.trim() ?? null;
    }
  }

  const totais = lerTotais(brutas);

  let vendedorDoc = "";
  let vendedorNome = "";
  let ordem = 0;

  for (let i = 0; i < linhas.length; i += 1) {
    const atual = linhas[i]!;

    const cabecalhoVendedor = atual.texto.match(RE_VENDEDOR);
    if (cabecalhoVendedor) {
      vendedorDoc = normalizarDocumento(cabecalhoVendedor[1]);
      vendedorNome = limparNomeVendedor(cabecalhoVendedor[2]);
      continue;
    }

    // A linha de valores é a âncora: a anterior traz o cliente, a seguinte o tipo.
    if (!RE_LINHA_VALORES.test(atual.texto)) continue;

    const linhaCliente = linhas[i - 1]?.texto ?? "";
    const linhaOrigem = linhas[i + 1]?.texto ?? "";

    try {
      registros.push(
        montarRegistro({
          linhaCliente,
          linhaValores: atual.texto,
          linhaOrigem,
          faixas,
          vendedorDoc,
          vendedorNome,
          pagina: atual.pagina,
          ordem: ordem + 1,
        }),
      );
      ordem += 1;
    } catch (erro) {
      erros.push({
        pagina: atual.pagina,
        mensagem: erro instanceof Error ? erro.message : "Falha ao interpretar o registro.",
        conteudo: `${linhaCliente.trim()} | ${atual.texto.trim()} | ${linhaOrigem.trim()}`.slice(
          0,
          600,
        ),
      });
    }
  }

  const somaComissaoLida = arredondar(
    registros.reduce((total, registro) => total + registro.valorComissao, 0),
  );
  const somaSeguroLida = arredondar(
    registros.reduce((total, registro) => total + (registro.valorSeguro ?? 0), 0),
  );

  const divergencia =
    totais.comissao === null
      ? null
      : arredondar(totais.comissao - (somaComissaoLida + somaSeguroLida));

  return {
    registros,
    erros,
    paginas,
    formulario,
    dataEmissao,
    administradora,
    totais,
    somaComissaoLida,
    somaSeguroLida,
    divergencia,
  };
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function lerTotais(brutas: readonly LinhaDocumento[]): TotaisRelatorio {
  const totais: TotaisRelatorio = {
    bensImoveis: null,
    bensMoveis: null,
    comissao: null,
    impostoRenda: null,
    liquido: null,
  };

  for (const { texto } of brutas) {
    const capturar = (padrao: RegExp): number | null => {
      const encontrado = texto.match(padrao);
      return encontrado ? parseValorBr(encontrado[1]) : null;
    };

    totais.bensImoveis ??= capturar(/VLR\.\s*BENS\s+IMOVEIS:\s*([\d.]+,\d{2})/);
    totais.bensMoveis ??= capturar(/VLR\.\s*BENS\s+MOVEIS:\s*([\d.]+,\d{2})/);
    totais.comissao ??= capturar(/VLR\.\s*COMISSAO:\s*([\d.]+,\d{2})/);
    totais.impostoRenda ??= capturar(/I\.R\.[^:]*:\s*([\d.]+,\d{2})/);
    totais.liquido ??= capturar(/TOTAL\s+LIQUIDO:\s*([\d.]+,\d{2})/);
  }

  return totais;
}

interface EntradaRegistro {
  linhaCliente: string;
  linhaValores: string;
  linhaOrigem: string;
  faixas: FaixasValores;
  vendedorDoc: string;
  vendedorNome: string;
  pagina: number;
  ordem: number;
}

function montarRegistro(entrada: EntradaRegistro): RegistroComissaoPdf {
  const identificacao = entrada.linhaValores.match(RE_LINHA_VALORES);
  if (!identificacao) {
    throw new Error("Linha de valores sem grupo/cota identificáveis.");
  }

  const grupo = normalizarGrupo(identificacao[1]);
  // No relatório o dígito verificador da cota vem separado por ponto.
  const cota = normalizarCota(`${identificacao[2]}-${identificacao[3]}`);

  const valorCredito = parseValorBr(recortar(entrada.linhaValores, entrada.faixas.credito));
  const valorComissao = parseValorBr(recortar(entrada.linhaValores, entrada.faixas.comissao));

  if (valorCredito === null) throw new Error("Valor de crédito ausente ou ilegível.");
  if (valorComissao === null) throw new Error("Valor de comissão ausente ou ilegível.");

  const objeto = entrada.linhaValores
    .slice(identificacao[0].length, entrada.faixas.credito[0])
    .trim();

  const cliente = entrada.linhaCliente.match(RE_LINHA_CLIENTE);
  if (!cliente) {
    throw new Error("Linha do cliente não localizada para o registro.");
  }

  const contrato = normalizarContrato(cliente[1]);
  if (!contrato) throw new Error("Contrato do registro não localizado.");

  const resto = cliente[3] ?? "";
  const separador = resto.lastIndexOf("/");
  const nomeCliente = (separador >= 0 ? resto.slice(0, separador) : resto).trim();
  const contatoCliente = separador >= 0 ? resto.slice(separador + 1).trim() || null : null;

  const origemTexto = recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.origem);
  const tipo: TipoLancamentoComissao = identificarTipoLancamento(origemTexto) ?? "OUTRO";

  const parcelaTexto = recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.parcela);
  const parcelaRelatorio = parcelaTexto ? Number(parcelaTexto.replace(/\D+/g, "")) : null;

  return {
    ordem: entrada.ordem,
    pagina: entrada.pagina,
    cpfCnpjVendedor: entrada.vendedorDoc,
    nomeVendedor: entrada.vendedorNome,
    contrato,
    grupo,
    cota,
    nomeCliente: nomeCliente || "CLIENTE NÃO IDENTIFICADO",
    contatoCliente,
    objeto: objeto || null,
    indicador: cliente[2] ?? null,
    valorCredito,
    percentualFlex: parseValorBr(recortar(entrada.linhaValores, entrada.faixas.flex)),
    valorComissao,
    valorDsr: parseValorBr(recortar(entrada.linhaValores, entrada.faixas.dsr)),
    valorSeguro: parseValorBr(recortar(entrada.linhaValores, entrada.faixas.seguro)),
    percentualComissao: parseValorBr(recortar(entrada.linhaValores, entrada.faixas.percentual)),
    tipo,
    tipoOriginal: origemTexto || "NAO INFORMADO",
    parcela: resolverParcela(tipo, parcelaRelatorio),
    dataPagamento: parseDataBr(recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.dataPagamento)),
    dataContabil: parseDataBr(recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.dataContabil)),
    dataCheque: parseDataBr(recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.dataCheque)),
    dataVenda: parseDataBr(recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.dataVenda)),
    classificacaoObjeto: recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.classificacao) || null,
    assinatura: recortar(entrada.linhaOrigem, FAIXAS_ORIGEM.assinatura) || null,
  };
}

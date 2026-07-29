import type { SituacaoCota } from "@prisma/client";
import {
  limparCampo,
  normalizarContrato,
  normalizarCota,
  normalizarDocumento,
  normalizarGrupo,
  normalizarTexto,
  parseBooleanoSN,
  parseDataBr,
  parseInteiro,
  parseValorBr,
} from "@/lib/normalize";

/**
 * Leitor do arquivo de produção da administradora (layout SERVOPA).
 *
 * O arquivo é delimitado por ponto e vírgula, com campos preenchidos até
 * largura fixa. As colunas são mapeadas pelo nome do cabeçalho — nunca pela
 * posição — para tolerar mudanças de ordem ou colunas novas no layout.
 */

export interface LinhaBase {
  numeroLinha: number;
  dataVenda: Date | null;
  dataEntrada: Date | null;
  grupo: string;
  cota: string;
  contrato: string;
  situacaoOriginal: string | null;
  situacao: SituacaoCota;
  diaVencimento: number | null;
  valorCredito: number | null;
  valorParcela: number | null;
  meioPagamento: string | null;
  segmento: string | null;
  produto: string | null;
  prazo: number | null;
  parcelasPagas: number;
  parcelasAntecipadas: number;
  parcelasEmitidas: number;
  dataUltimoPagamento: Date | null;
  contemplado: boolean;
  dataContemplacao: Date | null;
  valorCreditoContemplado: number | null;
  alienado: boolean;
  taxaAdm: number | null;
  taxaFunres: number | null;
  cpfCnpjCliente: string;
  tipoPessoa: string | null;
  nomeCliente: string;
  contatoCliente: string | null;
  emailCliente: string | null;
  ufCliente: string | null;
  temSeguro: boolean;
  valorSeguro: number | null;
  temFlex: boolean;
  taxaFlex: number | null;
  cpfCnpjParceiro: string | null;
  cpfCnpjVendedor: string;
  nomeVendedor: string | null;
  cpfCnpjParceiroComercial: string | null;
  nomeParceiroComercial: string | null;
  origemVenda: string | null;
  dataCancelamento: Date | null;
  dataAlienacao: Date | null;
}

export interface ErroLinha {
  numeroLinha: number;
  mensagem: string;
  conteudo: string;
}

export interface ResultadoLeituraCsv {
  linhas: LinhaBase[];
  erros: ErroLinha[];
  totalLinhas: number;
  colunasDesconhecidas: string[];
}

/** Nome canônico → possíveis cabeçalhos no arquivo. */
const CAMPOS = {
  dataVenda: ["DT_VENDA"],
  dataEntrada: ["DT_ENTRADA"],
  grupo: ["NR_GRUPO"],
  cota: ["NR_COTA"],
  contrato: ["NR_CONTRATO"],
  situacao: ["DS_SITUACAO"],
  diaVencimento: ["NR_DIAVENC"],
  valorCredito: ["VL_CREDITO"],
  valorParcela: ["VL_PARCELA"],
  meioPagamento: ["DS_MEIO_PAGAMENTO"],
  segmento: ["DS_SEGMENTO"],
  produto: ["DS_PRODUTO"],
  prazo: ["QT_PRAZO"],
  parcelasPagas: ["QT_PARCELAS_PAGAS"],
  parcelasAntecipadas: ["QT_PARCELAS_ANTECIPADAS"],
  parcelasEmitidas: ["QT_PARCELAS_EMITIDAS"],
  dataUltimoPagamento: ["DT_ULTIMO_PAGAMENTO"],
  contemplado: ["ST_CONTEMPLADO"],
  dataContemplacao: ["DT_CONTEMPLACAO"],
  valorCreditoContemplado: ["VL_CREDITO_CONTEMPLADO"],
  alienado: ["ST_ALIENADO"],
  taxaAdm: ["TX_ADM"],
  taxaFunres: ["TX_FUNRES"],
  cpfCnpjCliente: ["NM_CPFCNPJ_CONSORCIADO"],
  tipoPessoa: ["TP_PESSOA"],
  nomeCliente: ["NM_CONSORCIADO"],
  contatoCliente: ["CD_CEL_CONSORCIADO"],
  emailCliente: ["NM_EMAIL_CONSORCIADO"],
  ufCliente: ["NM_UF_CONSORCIADO"],
  temSeguro: ["ST_SEGURO"],
  valorSeguro: ["VL_SEGURO"],
  temFlex: ["ST_FLEX"],
  taxaFlex: ["TX_FLEX"],
  cpfCnpjParceiro: ["NM_CPFCNPJ_PARCEIRO"],
  cpfCnpjVendedor: ["NM_CPFCNPJ_VENDEDOR"],
  nomeVendedor: ["NM_VENDEDOR"],
  cpfCnpjParceiroComercial: ["NM_CPFCNPJ_PARCEIRO_COMERCIAL"],
  nomeParceiroComercial: ["NM_PARCEIRO_COMERCIAL"],
  origemVenda: ["DS_ORIGEM_DA_VENDA"],
  dataCancelamento: ["DT_CANCELAMENTO"],
  // O cabeçalho vem truncado no arquivo original ("DT_ALIENA").
  dataAlienacao: ["DT_ALIENACAO", "DT_ALIENA"],
} as const;

type CampoCanonico = keyof typeof CAMPOS;

/**
 * Mapeia a situação textual da administradora para o enum interno,
 * preservando o texto original na cota.
 */
export function mapearSituacao(texto: string | null | undefined): SituacaoCota {
  const valor = normalizarTexto(texto);
  if (!valor) return "OUTRO";
  if (valor.startsWith("ATIVO")) return "ATIVO";
  if (valor.startsWith("CANCELAD") || valor.startsWith("ESTORNAD")) return "CANCELADO";
  if (valor.startsWith("CONTEMPLAD")) return "CONTEMPLADO";
  if (valor.startsWith("QUITAD") || valor.startsWith("ENCERRAD")) return "QUITADO";
  if (valor.startsWith("TRANSFERID")) return "TRANSFERIDO";
  if (valor.startsWith("ATRASO") || valor.startsWith("EM ATRASO")) return "EM_ATRASO";
  if (valor.startsWith("DESIST")) return "DESISTENTE";
  return "OUTRO";
}

function decodificar(conteudo: Buffer): string {
  const utf8 = conteudo.toString("utf8");
  // O caractere de substituição indica arquivo em Latin-1 (comum nos ERPs).
  if (utf8.includes("�")) {
    return conteudo.toString("latin1");
  }
  return utf8;
}

function dividirLinha(linha: string): string[] {
  // O layout não usa aspas; o separador é sempre ";".
  return linha.split(";");
}

export function lerCsvBase(conteudo: Buffer): ResultadoLeituraCsv {
  const texto = decodificar(conteudo).replace(/^﻿/, "");
  const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim().length > 0);

  if (linhas.length === 0) {
    return { linhas: [], erros: [], totalLinhas: 0, colunasDesconhecidas: [] };
  }

  const cabecalho = dividirLinha(linhas[0]!).map((coluna) => normalizarTexto(coluna));
  const indices = new Map<CampoCanonico, number>();
  const utilizadas = new Set<number>();

  for (const [campo, nomes] of Object.entries(CAMPOS) as [CampoCanonico, readonly string[]][]) {
    const indice = cabecalho.findIndex((coluna) =>
      nomes.some((nome) => coluna === nome || coluna.startsWith(nome)),
    );
    if (indice >= 0) {
      indices.set(campo, indice);
      utilizadas.add(indice);
    }
  }

  const obrigatorias: CampoCanonico[] = [
    "grupo",
    "cota",
    "contrato",
    "cpfCnpjCliente",
    "nomeCliente",
  ];
  const faltantes = obrigatorias.filter((campo) => !indices.has(campo));
  if (faltantes.length > 0) {
    throw new Error(
      `Layout do CSV não reconhecido. Colunas obrigatórias ausentes: ${faltantes
        .map((campo) => CAMPOS[campo][0])
        .join(", ")}.`,
    );
  }

  const colunasDesconhecidas = cabecalho.filter(
    (coluna, indice) => coluna.length > 0 && !utilizadas.has(indice),
  );

  const registros: LinhaBase[] = [];
  const erros: ErroLinha[] = [];

  for (let i = 1; i < linhas.length; i += 1) {
    const bruta = linhas[i]!;
    const numeroLinha = i + 1;
    const colunas = dividirLinha(bruta);

    const ler = (campo: CampoCanonico): string | null => {
      const indice = indices.get(campo);
      if (indice === undefined) return null;
      return limparCampo(colunas[indice]);
    };

    try {
      const cpfCnpjCliente = normalizarDocumento(ler("cpfCnpjCliente"));
      const nomeCliente = ler("nomeCliente");
      const contrato = normalizarContrato(ler("contrato"));
      const grupo = normalizarGrupo(ler("grupo"));
      const cota = normalizarCota(ler("cota"));

      const ausentes: string[] = [];
      if (!contrato) ausentes.push("contrato");
      if (!grupo) ausentes.push("grupo");
      if (!cota) ausentes.push("cota");
      if (!cpfCnpjCliente) ausentes.push("CPF/CNPJ do cliente");
      if (!nomeCliente) ausentes.push("nome do cliente");

      if (ausentes.length > 0) {
        erros.push({
          numeroLinha,
          mensagem: `Identificação incompleta da cota: ${ausentes.join(", ")}.`,
          conteudo: bruta.slice(0, 500),
        });
        continue;
      }

      const situacaoOriginal = ler("situacao");

      registros.push({
        numeroLinha,
        dataVenda: parseDataBr(ler("dataVenda")),
        dataEntrada: parseDataBr(ler("dataEntrada")),
        grupo,
        cota,
        contrato,
        situacaoOriginal,
        situacao: mapearSituacao(situacaoOriginal),
        diaVencimento: parseInteiro(ler("diaVencimento")),
        valorCredito: parseValorBr(ler("valorCredito")),
        valorParcela: parseValorBr(ler("valorParcela")),
        meioPagamento: ler("meioPagamento"),
        segmento: ler("segmento"),
        produto: ler("produto"),
        prazo: parseInteiro(ler("prazo")),
        parcelasPagas: parseInteiro(ler("parcelasPagas")) ?? 0,
        parcelasAntecipadas: parseInteiro(ler("parcelasAntecipadas")) ?? 0,
        parcelasEmitidas: parseInteiro(ler("parcelasEmitidas")) ?? 0,
        dataUltimoPagamento: parseDataBr(ler("dataUltimoPagamento")),
        contemplado: parseBooleanoSN(ler("contemplado")),
        dataContemplacao: parseDataBr(ler("dataContemplacao")),
        valorCreditoContemplado: parseValorBr(ler("valorCreditoContemplado")),
        alienado: parseBooleanoSN(ler("alienado")),
        taxaAdm: parseValorBr(ler("taxaAdm")),
        taxaFunres: parseValorBr(ler("taxaFunres")),
        cpfCnpjCliente,
        tipoPessoa: ler("tipoPessoa"),
        nomeCliente: nomeCliente!,
        contatoCliente: ler("contatoCliente"),
        emailCliente: ler("emailCliente"),
        ufCliente: ler("ufCliente"),
        temSeguro: parseBooleanoSN(ler("temSeguro")),
        valorSeguro: parseValorBr(ler("valorSeguro")),
        temFlex: parseBooleanoSN(ler("temFlex")),
        taxaFlex: parseValorBr(ler("taxaFlex")),
        cpfCnpjParceiro: normalizarDocumento(ler("cpfCnpjParceiro")) || null,
        cpfCnpjVendedor: normalizarDocumento(ler("cpfCnpjVendedor")),
        nomeVendedor: ler("nomeVendedor"),
        cpfCnpjParceiroComercial: normalizarDocumento(ler("cpfCnpjParceiroComercial")) || null,
        nomeParceiroComercial: ler("nomeParceiroComercial"),
        origemVenda: ler("origemVenda"),
        dataCancelamento: parseDataBr(ler("dataCancelamento")),
        dataAlienacao: parseDataBr(ler("dataAlienacao")),
      });
    } catch (erro) {
      erros.push({
        numeroLinha,
        mensagem: erro instanceof Error ? erro.message : "Erro desconhecido ao ler a linha.",
        conteudo: bruta.slice(0, 500),
      });
    }
  }

  return {
    linhas: registros,
    erros,
    totalLinhas: linhas.length - 1,
    colunasDesconhecidas,
  };
}

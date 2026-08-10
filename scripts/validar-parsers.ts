/**
 * Validação dos parsers contra arquivos reais, sem tocar no banco.
 *
 * Uso:
 *   npx tsx scripts/validar-parsers.ts arquivo1 [arquivo2 ...]
 *
 * O tipo de cada arquivo é reconhecido pelo conteúdo, não pelo nome: os
 * relatórios saem da administradora com nomes que mudam a cada exportação.
 *
 * O número que importa é a DIVERGÊNCIA: a diferença entre o que o parser somou
 * e o total impresso no rodapé do próprio relatório. Zero significa que o
 * arquivo foi lido inteiro e corretamente.
 *
 * Divergência diferente de zero **nem sempre é defeito de leitura**. Um recorte
 * do relatório — algumas páginas de um fechamento maior — traz no rodapé o
 * total do documento inteiro, e aí a diferença é justamente o que ficou de
 * fora. O cabeçalho de cada página traz o número dela no relatório original; se
 * a primeira não for a página 1, é recorte.
 */
import { readFile } from "node:fs/promises";
import { lerCsvBase } from "@/server/importacao/csv-base";
import { FORMULARIOS, lerFormulario } from "@/server/importacao/formularios";
import { lerPdfComissao } from "@/server/importacao/pdf-comissao";
import { lerPdfBonus } from "@/server/importacao/pdf-bonus";
import { lerPdfComissaoVendedor } from "@/server/importacao/pdf-comissao-vendedor";

const caminhos = process.argv.slice(2);

function moeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function veredito(divergencia: number | null): string {
  if (divergencia === null) return "sem total no rodapé para conferir";
  if (divergencia === 0) return "OK — bate com o rodapé do relatório";
  return `DIVERGÊNCIA de ${moeda(divergencia)} — arquivo incompleto ou erro de leitura`;
}

async function validarCsv(caminho: string, arquivo: Buffer) {
  const csv = lerCsvBase(arquivo);
  console.log(`\n=== ${caminho} — BASE DE CLIENTES (CSV) ===`);
  console.log(`linhas: ${csv.totalLinhas} | lidas: ${csv.linhas.length} | erros: ${csv.erros.length}`);
  console.log("colunas não mapeadas:", csv.colunasDesconhecidas.length ? csv.colunasDesconhecidas : "nenhuma");

  const situacoes = new Map<string, number>();
  for (const linha of csv.linhas) {
    situacoes.set(linha.situacao, (situacoes.get(linha.situacao) ?? 0) + 1);
  }
  console.log("situações:", Object.fromEntries(situacoes));
  console.log("crédito total:", moeda(csv.linhas.reduce((s, l) => s + (l.valorCredito ?? 0), 0)));
  console.log("com flex:", csv.linhas.filter((l) => l.temFlex).length);
  if (csv.erros.length) console.log("primeiros erros:", csv.erros.slice(0, 3));
}

async function validarComissao(caminho: string, arquivo: Buffer) {
  const pdf = await lerPdfComissao(arquivo);
  console.log(`\n=== ${caminho} — CV056E, comissão que a WR recebe ===`);
  console.log(`páginas: ${pdf.paginas} | registros: ${pdf.registros.length} | erros: ${pdf.erros.length}`);
  console.log(`emissão: ${pdf.dataEmissao?.toISOString().slice(0, 10) ?? "—"} | ${pdf.administradora ?? "—"}`);
  console.log(`somado: ${moeda(pdf.somaComissaoLida + pdf.somaSeguroLida)} (comissão ${moeda(pdf.somaComissaoLida)} + seguro ${moeda(pdf.somaSeguroLida)})`);
  console.log(`rodapé: ${moeda(pdf.totais.comissao)}`);
  console.log(">>>", veredito(pdf.divergencia));

  const tipos = new Map<string, number>();
  for (const registro of pdf.registros) {
    tipos.set(registro.tipoOriginal, (tipos.get(registro.tipoOriginal) ?? 0) + 1);
  }
  console.log("tipos de lançamento:", Object.fromEntries(tipos));
  if (pdf.erros.length) console.log("primeiros erros:", pdf.erros.slice(0, 3));
}

async function validarBonus(caminho: string, arquivo: Buffer) {
  const pdf = await lerPdfBonus(arquivo);
  console.log(`\n=== ${caminho} — GC070A, bônus de incentivo ===`);
  console.log(`páginas: ${pdf.paginas} | registros: ${pdf.registros.length} | erros: ${pdf.erros.length}`);
  console.log(
    `período: ${pdf.periodoInicio?.toISOString().slice(0, 10) ?? "—"} a ${pdf.periodoFim?.toISOString().slice(0, 10) ?? "—"}`,
  );
  console.log(`somado: ${moeda(pdf.registros.reduce((s, r) => s + r.valorIncentivo, 0))}`);
  console.log(">>>", veredito(pdf.divergencia));
  if (pdf.erros.length) console.log("primeiros erros:", pdf.erros.slice(0, 3));
}

async function validarComissaoVendedor(caminho: string, arquivo: Buffer) {
  const pdf = await lerPdfComissaoVendedor(arquivo);
  console.log(`\n=== ${caminho} — CV069E, comissão paga direto ao vendedor ===`);
  console.log(`páginas: ${pdf.paginas} | registros: ${pdf.registros.length} | erros: ${pdf.erros.length}`);
  const documentos = new Set(pdf.registros.map((r) => r.vendedorDocumento));
  console.log(`vendedores distintos: ${documentos.size}`);
  console.log(`somado: ${moeda(pdf.somaLida)} | rodapé: ${moeda(pdf.totalRelatorio)}`);
  console.log(">>>", veredito(pdf.divergencia));
  if (pdf.erros.length) console.log("primeiros erros:", pdf.erros.slice(0, 3));
}

/**
 * Lê o código do formulário no cabeçalho da primeira página.
 *
 * Procurar o código no binário do PDF dá falso positivo — os bytes comprimidos
 * contêm qualquer sequência por acaso, e os três relatórios acabam
 * identificados como o mesmo. O código precisa vir do TEXTO extraído.
 */
async function identificarFormulario(arquivo: Buffer): Promise<string | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(arquivo),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pagina = await documento.getPage(1);
  const conteudo = await pagina.getTextContent();
  const texto = conteudo.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");

  return lerFormulario(texto);
}

async function identificarEValidar(caminho: string) {
  const arquivo = await readFile(caminho);

  if (/\.csv$/i.test(caminho)) {
    await validarCsv(caminho, arquivo);
    return;
  }

  if (arquivo.subarray(0, 4).toString() !== "%PDF") {
    console.log(`\n=== ${caminho} ===\nnão é PDF nem CSV — ignorado.`);
    return;
  }

  const formulario = await identificarFormulario(arquivo);

  if (formulario && FORMULARIOS.COMISSAO_WR.includes(formulario as never)) {
    await validarComissao(caminho, arquivo);
    return;
  }
  if (formulario && FORMULARIOS.COMISSAO_VENDEDOR.includes(formulario as never)) {
    await validarComissaoVendedor(caminho, arquivo);
    return;
  }
  if (formulario && FORMULARIOS.BONUS.includes(formulario as never)) {
    await validarBonus(caminho, arquivo);
    return;
  }

  console.log(`\n=== ${caminho} ===`);
  console.log(
    formulario
      ? `formulário ${formulario} não é um dos três relatórios conhecidos.`
      : "não foi possível ler o código do formulário no cabeçalho.",
  );
}

async function main() {
  if (caminhos.length === 0) {
    console.log("Uso: npx tsx scripts/validar-parsers.ts arquivo1 [arquivo2 ...]");
    process.exit(1);
  }

  for (const caminho of caminhos) {
    try {
      await identificarEValidar(caminho);
    } catch (erro) {
      console.log(`\n=== ${caminho} ===`);
      console.log("FALHOU:", erro instanceof Error ? erro.message : erro);
    }
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

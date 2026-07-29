/**
 * Validação dos parsers contra arquivos reais.
 * Uso: npx tsx scripts/validar-parsers.ts <base.csv> <fechamento.pdf>
 */
import { readFile } from "node:fs/promises";
import { lerCsvBase } from "@/server/importacao/csv-base";
import { lerPdfComissao } from "@/server/importacao/pdf-comissao";

const [caminhoCsv, caminhoPdf] = process.argv.slice(2);

async function main() {

if (caminhoCsv) {
  const csv = await lerCsvBase(await readFile(caminhoCsv));
  console.log("=== CSV ===");
  console.log("linhas:", csv.totalLinhas, "lidas:", csv.linhas.length, "erros:", csv.erros.length);
  console.log("colunas não mapeadas:", csv.colunasDesconhecidas);
  const situacoes = new Map<string, number>();
  for (const l of csv.linhas) situacoes.set(l.situacao, (situacoes.get(l.situacao) ?? 0) + 1);
  console.log("situações:", Object.fromEntries(situacoes));
  console.log("crédito total:", csv.linhas.reduce((s, l) => s + (l.valorCredito ?? 0), 0));
  console.log("com flex:", csv.linhas.filter((l) => l.temFlex).length);
  console.log("amostra:", JSON.stringify(csv.linhas[0], null, 2).slice(0, 900));
}

if (caminhoPdf) {
  const pdf = await lerPdfComissao(await readFile(caminhoPdf));
  console.log("\n=== PDF ===");
  console.log("páginas:", pdf.paginas, "registros:", pdf.registros.length, "erros:", pdf.erros.length);
  console.log("emissão:", pdf.dataEmissao?.toISOString().slice(0, 10), "| administradora:", pdf.administradora);
  console.log("soma comissão lida:", pdf.somaComissaoLida);
  console.log("soma seguro lida:", pdf.somaSeguroLida);
  console.log("totais do relatório:", pdf.totais);
  console.log("DIVERGÊNCIA (deve ser 0):", pdf.divergencia);

  const porTipo = new Map<string, { qtd: number; soma: number }>();
  for (const r of pdf.registros) {
    const atual = porTipo.get(r.tipo) ?? { qtd: 0, soma: 0 };
    atual.qtd += 1;
    atual.soma = Math.round((atual.soma + r.valorComissao) * 100) / 100;
    porTipo.set(r.tipo, atual);
  }
  console.log("por tipo:", Object.fromEntries(porTipo));
  console.log("sem flex:", pdf.registros.filter((r) => r.percentualFlex === null).length);
  console.log("parcelas distintas:", [...new Set(pdf.registros.map((r) => r.parcela))].sort((a, b) => a - b));
  console.log("inclusões com parcela != 1:", pdf.registros.filter((r) => r.tipo === "INCLUSAO_DE_PLANO" && r.parcela !== 1).length);
  console.log("registros sem data de venda:", pdf.registros.filter((r) => !r.dataVenda).length);
  console.log("registros tipo OUTRO:", pdf.registros.filter((r) => r.tipo === "OUTRO").map((r) => r.tipoOriginal));
  console.log("amostra:", JSON.stringify(pdf.registros[0], null, 2));
  if (pdf.erros.length) console.log("erros:", pdf.erros.slice(0, 5));
}
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

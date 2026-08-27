import { inflateRawSync } from "node:zlib";

/**
 * Leitor mínimo de planilha `.xlsx`.
 *
 * Um `.xlsx` é um ZIP de arquivos XML. Ler as células exige três peças:
 * o índice das abas (`workbook.xml`), a tabela de textos compartilhados
 * (`sharedStrings.xml`) e o XML de cada aba. Nada além disso é necessário
 * para o que o ERP faz com planilha — ler valores.
 *
 * Escrito à mão, como o leitor do CSV da SERVOPA e o do PDF de fechamento. A
 * alternativa era uma biblioteca de planilha inteira: capaz de escrever,
 * formatar, desenhar gráfico e calcular fórmula, com nove vulnerabilidades
 * transitivas conhecidas, para uma importação que só precisa do texto das
 * células. O `zlib` do Node já descomprime; o resto é XML.
 *
 * Deliberadamente não suporta: fórmulas (lê o último valor calculado, que é o
 * que o Excel grava), formatação, células mescladas e datas como número serial
 * — o cadastro usa texto, e converter data aqui esconderia erro de digitação
 * que o importador precisa reportar.
 */

export interface AbaPlanilha {
  nome: string;
  /** Linhas na ordem da planilha; célula vazia vira string vazia. */
  linhas: string[][];
}

export function lerPlanilha(arquivo: Buffer): AbaPlanilha[] {
  const entradas = lerZip(arquivo);

  const workbook = texto(entradas.get("xl/workbook.xml"));
  if (!workbook) {
    throw new Error(
      "O arquivo não é uma planilha .xlsx válida — não foi encontrado o índice de abas.",
    );
  }

  const textos = lerTextosCompartilhados(texto(entradas.get("xl/sharedStrings.xml")));
  const alvos = resolverAbas(workbook, texto(entradas.get("xl/_rels/workbook.xml.rels")));

  return alvos.map((alvo) => ({
    nome: alvo.nome,
    linhas: lerAba(texto(entradas.get(alvo.caminho)) ?? "", textos),
  }));
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

/**
 * Extrai as entradas pelo diretório central do ZIP.
 *
 * O diretório central é lido, e não os cabeçalhos locais, porque só ele é
 * confiável: o cabeçalho local pode declarar tamanho zero e remeter a um
 * descritor no fim dos dados, o que obrigaria a varrer o arquivo à procura de
 * assinatura. O diretório central sempre traz o tamanho real.
 */
function lerZip(arquivo: Buffer): Map<string, Buffer> {
  const fimDoDiretorio = localizarFimDoDiretorio(arquivo);
  if (fimDoDiretorio < 0) {
    throw new Error("O arquivo não é um .xlsx: estrutura ZIP não reconhecida.");
  }

  const quantidade = arquivo.readUInt16LE(fimDoDiretorio + 10);
  let posicao = arquivo.readUInt32LE(fimDoDiretorio + 16);

  const entradas = new Map<string, Buffer>();

  for (let indice = 0; indice < quantidade; indice += 1) {
    if (arquivo.readUInt32LE(posicao) !== 0x02014b50) break;

    const compressao = arquivo.readUInt16LE(posicao + 10);
    const tamanhoComprimido = arquivo.readUInt32LE(posicao + 20);
    const tamanhoNome = arquivo.readUInt16LE(posicao + 28);
    const tamanhoExtra = arquivo.readUInt16LE(posicao + 30);
    const tamanhoComentario = arquivo.readUInt16LE(posicao + 32);
    const inicioLocal = arquivo.readUInt32LE(posicao + 42);
    const nome = arquivo.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome);

    // O cabeçalho local tem campos de nome e extra próprios, com tamanhos que
    // podem diferir dos do diretório central. Os dados começam depois deles.
    const nomeLocal = arquivo.readUInt16LE(inicioLocal + 26);
    const extraLocal = arquivo.readUInt16LE(inicioLocal + 28);
    const inicioDados = inicioLocal + 30 + nomeLocal + extraLocal;
    const dados = arquivo.subarray(inicioDados, inicioDados + tamanhoComprimido);

    if (compressao === 0) entradas.set(nome, Buffer.from(dados));
    else if (compressao === 8) entradas.set(nome, inflateRawSync(dados));

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return entradas;
}

/**
 * Assinatura do fim do diretório central, procurada de trás para frente.
 *
 * Fica nos últimos 22 bytes quando não há comentário, mas o comentário pode
 * empurrá-la até 64 KB para trás — daí a varredura.
 */
function localizarFimDoDiretorio(arquivo: Buffer): number {
  const minimo = Math.max(0, arquivo.length - 22 - 0xffff);
  for (let posicao = arquivo.length - 22; posicao >= minimo; posicao -= 1) {
    if (arquivo.readUInt32LE(posicao) === 0x06054b50) return posicao;
  }
  return -1;
}

function texto(entrada: Buffer | undefined): string | null {
  return entrada ? entrada.toString("utf8") : null;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/**
 * Textos compartilhados.
 *
 * O Excel não repete a mesma string em duas células: grava uma vez aqui e
 * referencia pelo índice. Uma string pode vir partida em vários `<t>` quando
 * tem formatação no meio, e as partes precisam ser concatenadas.
 */
function lerTextosCompartilhados(xml: string | null): string[] {
  if (!xml) return [];

  const itens: string[] = [];
  for (const item of xml.match(/<si>[\s\S]*?<\/si>|<si\/>/g) ?? []) {
    const partes = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((parte) => parte[1]);
    itens.push(desescapar(partes.join("")));
  }
  return itens;
}

interface AbaAlvo {
  nome: string;
  caminho: string;
}

/**
 * Nome e caminho de cada aba.
 *
 * O `workbook.xml` dá o nome e o id da relação; o arquivo de relações traduz
 * esse id para o caminho real. A ordem das abas no `workbook.xml` é a ordem
 * que o usuário vê, e é ela que se preserva.
 */
function resolverAbas(workbook: string, relacoes: string | null): AbaAlvo[] {
  const caminhoPorId = new Map<string, string>();

  for (const relacao of relacoes?.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /\bId="([^"]+)"/.exec(relacao)?.[1];
    const alvo = /\bTarget="([^"]+)"/.exec(relacao)?.[1];
    if (!id || !alvo) continue;
    caminhoPorId.set(id, alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`);
  }

  const abas: AbaAlvo[] = [];
  let ordem = 0;

  for (const aba of workbook.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const nome = /\bname="([^"]*)"/.exec(aba)?.[1];
    const id = /\br:id="([^"]+)"/.exec(aba)?.[1];
    if (!nome) continue;

    ordem += 1;
    // Sem relações declaradas, a convenção de nomes é o único caminho — e é a
    // que o próprio Excel usa ao gravar.
    const caminho =
      (id ? caminhoPorId.get(id) : undefined) ?? `xl/worksheets/sheet${ordem}.xml`;

    abas.push({ nome: desescapar(nome), caminho });
  }

  return abas;
}

/**
 * Células de uma aba, em grade.
 *
 * A referência (`A1`, `BC12`) é a fonte da posição: o Excel omite células
 * vazias, e confiar na ordem das tags deslocaria colunas inteiras numa linha
 * com buraco no meio.
 */
function lerAba(xml: string, textos: readonly string[]): string[][] {
  const linhas: string[][] = [];

  for (const linha of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const celulas: string[] = [];

    for (const celula of linha.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const referencia = /\br="([A-Z]+)\d+"/.exec(celula)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(celula)?.[1] ?? "n";
      const coluna = referencia ? indiceDaColuna(referencia) : celulas.length;

      while (celulas.length < coluna) celulas.push("");
      celulas.push(valorDaCelula(celula, tipo, textos));
    }

    linhas.push(celulas);
  }

  return linhas;
}

function valorDaCelula(celula: string, tipo: string, textos: readonly string[]): string {
  // String literal na própria célula, em vez de na tabela compartilhada.
  if (tipo === "inlineStr") {
    const partes = [...celula.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((parte) => parte[1]);
    return desescapar(partes.join("")).trim();
  }

  const bruto = /<v>([\s\S]*?)<\/v>/.exec(celula)?.[1];
  if (bruto === undefined) return "";

  if (tipo === "s") {
    const indice = Number(bruto);
    return (textos[indice] ?? "").trim();
  }

  // Booleano é gravado como 0 ou 1; devolver o dígito cru viraria "0" na tela.
  if (tipo === "b") return bruto === "1" ? "VERDADEIRO" : "FALSO";

  return desescapar(bruto).trim();
}

function indiceDaColuna(referencia: string): number {
  let indice = 0;
  for (const letra of referencia) {
    indice = indice * 26 + (letra.charCodeAt(0) - 64);
  }
  return indice - 1;
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codigo: string) =>
      String.fromCodePoint(Number.parseInt(codigo, 16)),
    )
    .replace(/&amp;/g, "&");
}

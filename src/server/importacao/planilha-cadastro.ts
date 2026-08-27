import type { CategoriaVendedor, SituacaoVendedor } from "@prisma/client";
import { normalizarTexto } from "@/lib/normalize";
import { lerPlanilha, type AbaPlanilha } from "./xlsx";

/**
 * Leitor da planilha de cadastro da WR.
 *
 * Três abas, cada uma respondendo por uma coisa:
 *
 * - **VENDEDORES** — quem é, sob qual supervisão e gerência, e se está ativo;
 * - **HISTORICO CATEGORIA** — uma linha por mudança, com o mês em que passou a
 *   valer. É o que permite julgar uma venda de 2024 pela categoria de 2024;
 * - **NOMES DE CADASTRO** — o de-para entre o nome que a administradora usa e
 *   o vendedor da WR. É a peça que liga o cadastro às vendas, porque o
 *   relatório da SERVOPA não traz o nome interno de vocês.
 *
 * As colunas são localizadas pelo NOME do cabeçalho, nunca pela posição: a
 * planilha é editada por pessoas, e uma coluna nova inserida no meio não pode
 * quebrar a importação. A linha de cabeçalho também é procurada, e não fixada,
 * porque as abas começam com título e instruções de preenchimento.
 *
 * Módulo sem banco: lê, valida o que dá para validar olhando só o arquivo, e
 * devolve os problemas com o número da linha. O que depende de cruzar com o
 * sistema fica com o importador.
 */

export interface LinhaVendedor {
  numeroLinha: number;
  codigo: string | null;
  nome: string;
  categoriaAtual: CategoriaVendedor | null;
  supervisor: string | null;
  gerente: string | null;
  situacao: SituacaoVendedor;
  observacao: string | null;
}

export interface LinhaCategoria {
  numeroLinha: number;
  vendedor: string;
  /** Primeiro dia do mês informado — é dele que a vigência vale. */
  vigenteDe: Date;
  /** O mês como veio escrito, para citar de volta na mensagem de erro. */
  mes: string;
  categoria: CategoriaVendedor;
  observacao: string | null;
}

export interface LinhaNome {
  numeroLinha: number;
  /** Como a administradora escreve. Pode vir truncado pelo relatório. */
  nomeRelatorio: string;
  /** Vazio quando não é vendedor da WR — parceiro, a própria WR. */
  vendedorWr: string | null;
  observacao: string | null;
}

export interface ProblemaLeitura {
  aba: string;
  numeroLinha: number;
  mensagem: string;
}

export interface PlanilhaCadastro {
  vendedores: LinhaVendedor[];
  categorias: LinhaCategoria[];
  nomes: LinhaNome[];
  problemas: ProblemaLeitura[];
}

const ABA_VENDEDORES = ["VENDEDORES", "CADASTRO DE VENDEDORES", "CADASTRO DOS VENDEDORES"];
const ABA_CATEGORIA = ["HISTORICO CATEGORIA", "HISTÓRICO CATEGORIA", "HISTORICO DE CATEGORIA"];
const ABA_NOMES = ["NOMES DE CADASTRO", "NOMES", "DE-PARA"];

const CATEGORIAS: Record<string, CategoriaVendedor> = {
  INICIANTE: "INICIANTE",
  VETERANO: "VETERANO",
  EXPERT: "EXPERT",
};

const SITUACOES: Record<string, SituacaoVendedor> = {
  ATIVO: "ATIVO",
  DESLIGADO: "DESLIGADO",
  INATIVO: "INATIVO",
  AFASTADO: "AFASTADO",
};

/**
 * Texto longo demais para ser nome de gente.
 *
 * As abas trazem instruções de preenchimento em células soltas, e algumas
 * ficam DENTRO da faixa de dados — abaixo do cabeçalho, misturadas às linhas
 * de verdade. Reportá-las como erro encheria a tela de ruído em toda
 * importação; o comprimento separa instrução de nome sem falso positivo,
 * porque nenhum nome de pessoa chega perto disso.
 */
const LIMITE_DE_NOME = 80;

export function lerPlanilhaCadastro(arquivo: Buffer): PlanilhaCadastro {
  const abas = lerPlanilha(arquivo);
  const problemas: ProblemaLeitura[] = [];

  const vendedores = lerVendedores(exigirAba(abas, ABA_VENDEDORES, "VENDEDORES"), problemas);
  const categorias = lerCategorias(
    exigirAba(abas, ABA_CATEGORIA, "HISTORICO CATEGORIA"),
    problemas,
  );
  const nomes = lerNomes(exigirAba(abas, ABA_NOMES, "NOMES DE CADASTRO"), problemas);

  return { vendedores, categorias, nomes, problemas };
}

function exigirAba(
  abas: readonly AbaPlanilha[],
  aceitos: readonly string[],
  rotulo: string,
): AbaPlanilha {
  const alvo = abas.find((aba) =>
    aceitos.some((aceito) => normalizarTexto(aba.nome) === normalizarTexto(aceito)),
  );

  if (!alvo) {
    const existentes = abas.map((aba) => `"${aba.nome}"`).join(", ");
    throw new Error(
      `A planilha não tem a aba "${rotulo}". Abas encontradas: ${existentes || "nenhuma"}.`,
    );
  }

  return alvo;
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

function lerVendedores(aba: AbaPlanilha, problemas: ProblemaLeitura[]): LinhaVendedor[] {
  const mapa = localizarCabecalho(aba, {
    nome: ["VENDEDOR", "NOME", "NOME DO VENDEDOR"],
    categoria: ["CATEGORIA ATUAL", "CATEGORIA"],
    supervisor: ["SUPERVISOR", "SUPERVISAO", "EQUIPE"],
    gerente: ["GERENTE", "GERENCIA"],
    situacao: ["SITUACAO", "STATUS"],
    codigo: ["COD", "CODIGO"],
    observacao: ["OBSERVACAO", "OBS"],
  });

  const linhas: LinhaVendedor[] = [];

  for (const { numeroLinha, celulas } of dados(aba, mapa.linhaCabecalho)) {
    const nome = mapa.ler(celulas, "nome");
    if (!nome || nome.length > LIMITE_DE_NOME) continue;

    const categoriaBruta = mapa.ler(celulas, "categoria");
    const categoria = categoriaBruta ? CATEGORIAS[normalizarTexto(categoriaBruta)] : undefined;
    if (categoriaBruta && !categoria) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `Categoria "${categoriaBruta}" não é INICIANTE, VETERANO nem EXPERT.`,
      });
    }

    const situacaoBruta = mapa.ler(celulas, "situacao");
    const situacao = situacaoBruta ? SITUACOES[normalizarTexto(situacaoBruta)] : undefined;
    if (situacaoBruta && !situacao) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `Situação "${situacaoBruta}" não é ATIVO nem DESLIGADO.`,
      });
    }

    linhas.push({
      numeroLinha,
      codigo: mapa.ler(celulas, "codigo"),
      nome,
      categoriaAtual: categoria ?? null,
      supervisor: mapa.ler(celulas, "supervisor"),
      gerente: mapa.ler(celulas, "gerente"),
      // Sem situação escrita o vendedor entra ativo: é o que a planilha
      // significa quando a coluna fica em branco.
      situacao: situacao ?? "ATIVO",
      observacao: mapa.ler(celulas, "observacao"),
    });
  }

  return linhas;
}

function lerCategorias(aba: AbaPlanilha, problemas: ProblemaLeitura[]): LinhaCategoria[] {
  const mapa = localizarCabecalho(aba, {
    vendedor: ["VENDEDOR", "NOME"],
    mes: ["A PARTIR DE (AAAA-MM)", "A PARTIR DE", "MES", "VIGENCIA", "DATA"],
    categoria: ["CATEGORIA"],
    observacao: ["OBSERVACAO", "OBS"],
  });

  const linhas: LinhaCategoria[] = [];
  const vistos = new Map<string, string>();

  for (const { numeroLinha, celulas } of dados(aba, mapa.linhaCabecalho)) {
    const vendedor = mapa.ler(celulas, "vendedor");
    if (!vendedor || vendedor.length > LIMITE_DE_NOME) continue;

    const mes = mapa.ler(celulas, "mes");
    const categoriaBruta = mapa.ler(celulas, "categoria");

    // Linha pela metade é erro de preenchimento, não instrução solta: sem os
    // dois campos não há período nenhum a registrar, e o silêncio faria a
    // mudança de categoria simplesmente não acontecer.
    if (!mes || !categoriaBruta) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `${vendedor}: falta ${!mes ? "o mês" : "a categoria"} nesta linha.`,
      });
      continue;
    }

    const vigenteDe = primeiroDiaDoMes(mes);
    if (!vigenteDe) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `${vendedor}: "${mes}" não é um mês no formato AAAA-MM (por exemplo 2026-08).`,
      });
      continue;
    }

    const categoria = CATEGORIAS[normalizarTexto(categoriaBruta)];
    if (!categoria) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `${vendedor}: categoria "${categoriaBruta}" não é INICIANTE, VETERANO nem EXPERT.`,
      });
      continue;
    }

    // Duas categorias diferentes no mesmo mês para a mesma pessoa não têm
    // desempate possível pelo arquivo: a de baixo prevalece, mas alguém
    // precisa dizer qual está certa. Uma delas está errada, e a diferença é
    // quanto aquele mês inteiro de vendas paga.
    const chave = `${normalizarTexto(vendedor)}|${mes}`;
    const anterior = vistos.get(chave);
    if (anterior && anterior !== categoria) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem:
          `${vendedor}: duas categorias diferentes em ${mes} (${anterior} e ${categoria}). ` +
          `Vale a última; apague a linha errada.`,
      });
    }
    vistos.set(chave, categoria);

    linhas.push({
      numeroLinha,
      vendedor,
      vigenteDe,
      mes,
      categoria,
      observacao: mapa.ler(celulas, "observacao"),
    });
  }

  return linhas;
}

function lerNomes(aba: AbaPlanilha, problemas: ProblemaLeitura[]): LinhaNome[] {
  const mapa = localizarCabecalho(aba, {
    relatorio: [
      "NOME NO RELATORIO DA ADMINISTRADORA",
      "NOME NO RELATORIO",
      "SERVOPA",
      "NOME NA ADMINISTRADORA",
    ],
    wr: ["VENDEDOR DA WR", "VENDEDOR", "NOSSO CADASTRO"],
    observacao: ["OBSERVACAO", "OBS"],
  });

  const linhas: LinhaNome[] = [];
  const vistos = new Set<string>();

  for (const { numeroLinha, celulas } of dados(aba, mapa.linhaCabecalho)) {
    const nomeRelatorio = mapa.ler(celulas, "relatorio");
    if (!nomeRelatorio || nomeRelatorio.length > LIMITE_DE_NOME) continue;

    const chave = normalizarTexto(nomeRelatorio);
    if (vistos.has(chave)) {
      problemas.push({
        aba: aba.nome,
        numeroLinha,
        mensagem: `"${nomeRelatorio}" aparece mais de uma vez. Só a primeira linha vale.`,
      });
      continue;
    }
    vistos.add(chave);

    linhas.push({
      numeroLinha,
      nomeRelatorio,
      vendedorWr: mapa.ler(celulas, "wr"),
      observacao: mapa.ler(celulas, "observacao"),
    });
  }

  return linhas;
}

// ---------------------------------------------------------------------------
// Cabeçalho e células
// ---------------------------------------------------------------------------

interface MapaColunas<C extends string> {
  linhaCabecalho: number;
  ler(celulas: readonly string[], campo: C): string | null;
}

/**
 * Encontra a linha de cabeçalho e a posição de cada coluna.
 *
 * A linha escolhida é a primeira que casa com o maior número de colunas
 * conhecidas. Procurar em vez de fixar a linha é o que permite à planilha ter
 * título e instruções em cima sem que ninguém precise contar linhas.
 */
function localizarCabecalho<C extends string>(
  aba: AbaPlanilha,
  colunas: Record<C, readonly string[]>,
): MapaColunas<C> {
  const campos = Object.keys(colunas) as C[];
  let melhor = { linha: -1, acertos: 0, posicoes: new Map<C, number>() };

  for (const [indice, celulas] of aba.linhas.slice(0, 30).entries()) {
    const posicoes = new Map<C, number>();

    for (const campo of campos) {
      const aceitos = colunas[campo].map(normalizarTexto);
      const coluna = celulas.findIndex((celula) => aceitos.includes(normalizarTexto(celula)));
      if (coluna >= 0) posicoes.set(campo, coluna);
    }

    if (posicoes.size > melhor.acertos) {
      melhor = { linha: indice, acertos: posicoes.size, posicoes };
    }
  }

  if (melhor.acertos === 0) {
    throw new Error(
      `Não achei a linha de cabeçalho da aba "${aba.nome}". ` +
        `Esperava encontrar uma coluna chamada ${campos.map((campo) => `"${colunas[campo][0]}"`).join(", ")}.`,
    );
  }

  return {
    linhaCabecalho: melhor.linha,
    ler(celulas, campo) {
      const coluna = melhor.posicoes.get(campo);
      if (coluna === undefined) return null;
      const valor = (celulas[coluna] ?? "").trim();
      return valor === "" ? null : valor;
    },
  };
}

/** Linhas de dados, com o número que o usuário vê no Excel. */
function* dados(
  aba: AbaPlanilha,
  linhaCabecalho: number,
): Generator<{ numeroLinha: number; celulas: string[] }> {
  for (let indice = linhaCabecalho + 1; indice < aba.linhas.length; indice += 1) {
    const celulas = aba.linhas[indice] ?? [];
    if (celulas.every((celula) => celula.trim() === "")) continue;
    yield { numeroLinha: indice + 1, celulas };
  }
}

/**
 * Primeiro dia do mês escrito como AAAA-MM.
 *
 * Só este formato é aceito, de propósito. "08/2026" e "ago/26" seriam fáceis
 * de tolerar, mas "03/04" não tem resposta certa — e errar o mês de uma
 * mudança de categoria muda a comissão de todas as vendas do período.
 */
function primeiroDiaDoMes(texto: string): Date | null {
  const casamento = /^(\d{4})-(\d{2})$/.exec(texto.trim());
  if (!casamento) return null;

  const ano = Number(casamento[1]);
  const mes = Number(casamento[2]);
  if (mes < 1 || mes > 12) return null;

  return new Date(Date.UTC(ano, mes - 1, 1));
}

// ---------------------------------------------------------------------------
// Períodos de categoria
// ---------------------------------------------------------------------------

/**
 * Começo da linha do tempo.
 *
 * A planilha diz desde quando a pessoa é veterana, não desde quando ela
 * existe. Uma data-âncora anterior a qualquer venda evita o pior desfecho:
 * venda sem categoria não paga e não avisa.
 */
export const INICIO_DOS_TEMPOS = new Date(Date.UTC(2000, 0, 1));

interface PeriodoCategoria {
  categoria: CategoriaVendedor;
  vigenteDe: Date;
  vigenteAte: Date | null;
}

export function montarPeriodos(
  linhas: readonly LinhaCategoria[],
  categoriaAtual: CategoriaVendedor | null,
): PeriodoCategoria[] {
  // Sem nenhuma mudança registrada, a categoria atual vale desde sempre. É o
  // caso de quem entrou e nunca mudou — a maioria.
  if (linhas.length === 0) {
    return categoriaAtual
      ? [{ categoria: categoriaAtual, vigenteDe: INICIO_DOS_TEMPOS, vigenteAte: null }]
      : [];
  }

  const ordenadas = [...linhas].sort(
    (a, b) => a.vigenteDe.getTime() - b.vigenteDe.getTime() || a.numeroLinha - b.numeroLinha,
  );

  const periodos: PeriodoCategoria[] = [];

  for (const linha of ordenadas) {
    const anterior = periodos[periodos.length - 1];

    // Duas linhas no mesmo mês: a de baixo é a correção da de cima. Manter as
    // duas criaria um período de duração zero, e a resolução por data
    // devolveria a errada dependendo da ordem de leitura.
    if (anterior && anterior.vigenteDe.getTime() === linha.vigenteDe.getTime()) {
      anterior.categoria = linha.categoria;
      continue;
    }

    // Mesma categoria de novo é só ruído: prolonga o período em vez de partir.
    if (anterior && anterior.categoria === linha.categoria) continue;

    if (anterior) {
      const fim = new Date(linha.vigenteDe);
      fim.setUTCDate(fim.getUTCDate() - 1);
      anterior.vigenteAte = fim;
    }

    periodos.push({ categoria: linha.categoria, vigenteDe: linha.vigenteDe, vigenteAte: null });
  }

  // O primeiro período recua para o início dos tempos. A planilha diz desde
  // quando a pessoa é veterana, não desde quando ela existe — e uma venda
  // anterior à primeira linha ficaria sem categoria nenhuma, que é o pior dos
  // desfechos: não paga e não avisa.
  const primeiro = periodos[0];
  if (primeiro) primeiro.vigenteDe = INICIO_DOS_TEMPOS;

  return periodos;
}

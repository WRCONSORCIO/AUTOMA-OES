import { normalizarTexto } from "@/lib/normalize";

/**
 * Reconhecimento do mesmo vendedor por trás de documentos diferentes.
 *
 * O vendedor começa vendendo no CPF e abre CNPJ ao mudar de categoria. A razão
 * social quase nunca repete o nome do cadastro pessoal: ganha sufixo societário,
 * ganha a atividade, abrevia um sobrenome, às vezes carrega o próprio CPF.
 *
 * Comparar nome com nome exato encontra só a minoria dos casos. Aqui cada regra
 * declara a confiança do que encontrou, e o motivo em português — quem confirma
 * é sempre o usuário, e o vínculo é desfeito a qualquer momento.
 */

export type Confianca = "CERTO" | "ALTA" | "MEDIA" | "BAIXA";

export interface CadastroParaVinculo {
  id: string;
  nome: string;
  cpfCnpj: string;
  pessoaId: string | null;
}

export interface ParVinculo {
  a: string;
  b: string;
  confianca: Confianca;
  motivo: string;
}

/** Sufixos societários e atividades que a razão social acrescenta ao nome. */
const RUIDO_RAZAO_SOCIAL = new Set([
  "LTDA",
  "ME",
  "MEI",
  "EPP",
  "EIRELI",
  "SA",
  "S/A",
  "SS",
  "SOCIEDADE",
  "INDIVIDUAL",
  "EMPRESARIA",
  "UNIPESSOAL",
  "PROM",
  "PROMOTORA",
  "PROMOCAO",
  "PROMOCOES",
  "CONSULTORIA",
  "CONSULTORA",
  "ASSESSORIA",
  "CORRETORA",
  "CORRETAGEM",
  "REPRESENTACAO",
  "REPRESENTACOES",
  "INTERMEDIACAO",
  "AGENCIAMENTO",
  "SERVICO",
  "SERVICOS",
  "COMERCIO",
  "COMERCIAL",
  "NEGOCIO",
  "NEGOCIOS",
  "EMPREENDIMENTO",
  "EMPREENDIMENTOS",
  "INVESTIMENTO",
  "INVESTIMENTOS",
  "PARTICIPACOES",
  "IMOVEIS",
  "IMOBILIARIA",
  "IMOBILIARIO",
  "IMOBILIARIOS",
  "CONSORCIO",
  "CONSORCIOS",
  "VENDA",
  "VENDAS",
  "COTA",
  "COTAS",
]);

/** Conectivos que não distinguem uma pessoa de outra. */
const CONECTIVOS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "EM", "DEL", "DI"]);

/**
 * Reduz o nome ao que identifica a pessoa: sem acento, sem número, sem sufixo
 * societário e sem conectivo.
 */
export function nucleoDoNome(nome: string): string[] {
  return normalizarTexto(nome)
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !CONECTIVOS.has(token))
    .filter((token) => !RUIDO_RAZAO_SOCIAL.has(token));
}

/** CPFs escritos dentro da razão social — o MEI costuma carregar o do dono. */
export function cpfsNoNome(nome: string): string[] {
  return [...nome.matchAll(/(?<!\d)(\d{11})(?!\d)/g)].map((achado) => achado[1]!);
}

/** Distância de edição, limitada: acima do teto não interessa o valor exato. */
export function distanciaEdicao(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i, ...new Array<number>(b.length).fill(0)];
    let menor = i;

    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        atual[j - 1]! + 1,
        anterior[j]! + 1,
        anterior[j - 1]! + custo,
      );
      menor = Math.min(menor, atual[j]!);
    }

    if (menor > teto) return teto + 1;
    anterior = atual;
  }

  return anterior[b.length]!;
}

/** Um token abrevia o outro: "F" no lugar de "FERREIRA". */
function tokenCompativel(a: string, b: string): "IGUAL" | "ABREVIADO" | "DIFERENTE" {
  if (a === b) return "IGUAL";
  if (a.length === 1 && b.startsWith(a)) return "ABREVIADO";
  if (b.length === 1 && a.startsWith(b)) return "ABREVIADO";
  return "DIFERENTE";
}

function ehPrefixo(curto: string[], longo: string[]): boolean {
  if (curto.length >= longo.length) return false;
  return curto.every((token, indice) => token === longo[indice]);
}

/**
 * Compara dois cadastros e devolve o melhor motivo de vínculo, se houver.
 *
 * A ordem das regras é a ordem da confiança: a primeira que casa é a que vale.
 */
export function compararCadastros(
  a: CadastroParaVinculo,
  b: CadastroParaVinculo,
): { confianca: Confianca; motivo: string } | null {
  // 1. O CNPJ traz o CPF do dono na razão social. Não há dúvida possível.
  if (cpfsNoNome(a.nome).includes(b.cpfCnpj)) {
    return {
      confianca: "CERTO",
      motivo: `A razão social do CNPJ traz o CPF ${b.cpfCnpj} do outro cadastro`,
    };
  }
  if (cpfsNoNome(b.nome).includes(a.cpfCnpj)) {
    return {
      confianca: "CERTO",
      motivo: `A razão social do CNPJ traz o CPF ${a.cpfCnpj} do outro cadastro`,
    };
  }

  const nucleoA = nucleoDoNome(a.nome);
  const nucleoB = nucleoDoNome(b.nome);

  // Um nome só não identifica ninguém: "JHONATAS INVESTIMENTOS" fica de fora.
  if (nucleoA.length < 2 || nucleoB.length < 2) return null;

  // 2. Mesmo nome depois de tirar sufixo societário e atividade.
  if (nucleoA.join(" ") === nucleoB.join(" ")) {
    const iguaisNaOrigem = normalizarTexto(a.nome) === normalizarTexto(b.nome);
    return {
      confianca: "ALTA",
      motivo: iguaisNaOrigem
        ? "Mesmo nome nos dois cadastros"
        : "Mesmo nome depois de tirar o sufixo da razão social",
    };
  }

  // 3. Nome escrito sem um espaço: "SANTANAOLIVEIRA" e "SANTANA OLIVEIRA".
  const coladoA = nucleoA.join("");
  const coladoB = nucleoB.join("");

  if (coladoA === coladoB) {
    return { confianca: "ALTA", motivo: "Mesmo nome, diferindo apenas na separação das palavras" };
  }

  // 4. Um cadastro abrevia um sobrenome do outro.
  if (nucleoA.length === nucleoB.length) {
    const comparacoes = nucleoA.map((token, indice) => tokenCompativel(token, nucleoB[indice]!));
    const abreviados = comparacoes.filter((tipo) => tipo === "ABREVIADO").length;
    const diferentes = comparacoes.filter((tipo) => tipo === "DIFERENTE").length;

    if (diferentes === 0 && abreviados > 0) {
      return { confianca: "ALTA", motivo: "Mesmo nome, com sobrenome abreviado num dos cadastros" };
    }
  }

  // 5. Um nome continua o outro: sobrenome de casada, por exemplo.
  const [curto, longo] = nucleoA.length <= nucleoB.length ? [nucleoA, nucleoB] : [nucleoB, nucleoA];

  if (ehPrefixo(curto, longo)) {
    return curto.length >= 3
      ? { confianca: "ALTA", motivo: "Um cadastro tem um sobrenome a mais que o outro" }
      : { confianca: "MEDIA", motivo: "Um cadastro tem um sobrenome a mais que o outro" };
  }

  // 6. Diferença de digitação numa letra só, num nome longo.
  if (nucleoA[0] === nucleoB[0] && Math.min(coladoA.length, coladoB.length) >= 12) {
    const distancia = distanciaEdicao(coladoA, coladoB, 2);
    if (distancia === 1) {
      return { confianca: "ALTA", motivo: "Mesmo nome com uma letra de diferença" };
    }
    if (distancia === 2) {
      return { confianca: "MEDIA", motivo: "Nomes quase iguais, com duas letras de diferença" };
    }
  }

  // 7. Primeiro e último nome coincidem, o meio não.
  if (nucleoA[0] === nucleoB[0] && nucleoA.at(-1) === nucleoB.at(-1)) {
    return {
      confianca: "MEDIA",
      motivo: "Primeiro e último nome coincidem, o do meio não",
    };
  }

  return null;
}

export interface GrupoVinculo {
  chave: string;
  vendedorIds: string[];
  confianca: Confianca;
  motivos: string[];
}

const ORDEM: Record<Confianca, number> = { CERTO: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };

/**
 * Empresa batizada só com o primeiro nome do dono: "JHONATAS INVESTIMENTOS".
 *
 * Um primeiro nome não identifica ninguém, então esta regra só vale quando ele
 * é único na base inteira — havendo dois JHONATAS, não há como escolher, e a
 * sugestão não aparece.
 */
function paresPorPrimeiroNomeUnico(cadastros: CadastroParaVinculo[]): ParVinculo[] {
  const pessoas = cadastros
    .map((cadastro) => ({ cadastro, nucleo: nucleoDoNome(cadastro.nome) }))
    .filter((item) => item.nucleo.length >= 2);

  const pares: ParVinculo[] = [];

  for (const cadastro of cadastros) {
    const nucleo = nucleoDoNome(cadastro.nome);
    if (nucleo.length !== 1) continue;

    const primeiroNome = nucleo[0]!;
    const candidatos = pessoas.filter((item) => item.nucleo[0] === primeiroNome);
    if (candidatos.length !== 1) continue;

    const alvo = candidatos[0]!.cadastro;
    if (alvo.pessoaId && alvo.pessoaId === cadastro.pessoaId) continue;

    pares.push({
      a: cadastro.id,
      b: alvo.id,
      confianca: "BAIXA",
      motivo: `A empresa leva só o primeiro nome "${primeiroNome}", que aparece em um único vendedor`,
    });
  }

  return pares;
}

/** A confiança do grupo é a do elo mais fraco que o mantém unido. */
function menorConfianca(valores: Confianca[]): Confianca {
  return valores.reduce((pior, atual) => (ORDEM[atual] > ORDEM[pior] ? atual : pior), "CERTO");
}

/**
 * Encontra os pares e os junta em grupos.
 *
 * Se A casa com B e B casa com C, os três são a mesma pessoa — é o caso do
 * vendedor com CPF e dois CNPJs, em que os CNPJs podem não se parecer entre si.
 */
export function agruparSugestoes(cadastros: CadastroParaVinculo[]): GrupoVinculo[] {
  const pares: ParVinculo[] = [];

  for (let i = 0; i < cadastros.length; i += 1) {
    for (let j = i + 1; j < cadastros.length; j += 1) {
      const a = cadastros[i]!;
      const b = cadastros[j]!;

      // Já estão na mesma pessoa: não há sugestão a fazer.
      if (a.pessoaId && a.pessoaId === b.pessoaId) continue;

      const achado = compararCadastros(a, b);
      if (achado) {
        pares.push({ a: a.id, b: b.id, confianca: achado.confianca, motivo: achado.motivo });
      }
    }
  }

  pares.push(...paresPorPrimeiroNomeUnico(cadastros));

  // União dos pares em componentes conexos.
  const raiz = new Map<string, string>();
  const buscar = (id: string): string => {
    const pai = raiz.get(id);
    if (!pai || pai === id) return id;
    const encontrado = buscar(pai);
    raiz.set(id, encontrado);
    return encontrado;
  };
  const unir = (x: string, y: string): void => {
    const rx = buscar(x);
    const ry = buscar(y);
    if (rx !== ry) raiz.set(rx, ry);
  };

  for (const par of pares) {
    if (!raiz.has(par.a)) raiz.set(par.a, par.a);
    if (!raiz.has(par.b)) raiz.set(par.b, par.b);
    unir(par.a, par.b);
  }

  const grupos = new Map<string, { ids: Set<string>; confiancas: Confianca[]; motivos: Set<string> }>();

  for (const par of pares) {
    const chave = buscar(par.a);
    const grupo = grupos.get(chave) ?? {
      ids: new Set<string>(),
      confiancas: [],
      motivos: new Set<string>(),
    };
    grupo.ids.add(par.a);
    grupo.ids.add(par.b);
    grupo.confiancas.push(par.confianca);
    grupo.motivos.add(par.motivo);
    grupos.set(chave, grupo);
  }

  return [...grupos.entries()]
    .map(([chave, grupo]) => ({
      chave,
      vendedorIds: [...grupo.ids],
      confianca: menorConfianca(grupo.confiancas),
      motivos: [...grupo.motivos],
    }))
    .sort((a, b) => ORDEM[a.confianca] - ORDEM[b.confianca] || b.vendedorIds.length - a.vendedorIds.length);
}

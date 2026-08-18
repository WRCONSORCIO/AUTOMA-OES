/**
 * Núcleo do motor de fluxo: interpretar o que o cliente respondeu.
 *
 * É função pura de propósito. Toda a decisão sobre "o que essa resposta
 * significa" pode ser testada sem banco, sem WhatsApp e sem gateway — que é
 * onde os erros do atendimento aparecem primeiro.
 */

export interface OpcaoApresentada {
  /** Identificador do destino: id da opção, do plano ou do aparelho. */
  id: string;
  rotulo: string;
  valor: string;
}

export type ComandoGlobal = "menu" | "voltar" | "atendente";

export type Escolha =
  | { tipo: "opcao"; opcao: OpcaoApresentada; posicao: number }
  | { tipo: "comando"; comando: ComandoGlobal }
  | { tipo: "nenhuma" };

/**
 * Texto comparável: sem acento, sem emoji, sem pontuação, em minúsculas.
 *
 * "🆕 Nova contratação", "nova contratacao" e "NOVA CONTRATAÇÃO" precisam
 * casar — o cliente digita como quiser e o botão volta com o rótulo cheio de
 * enfeite.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALAVRAS_COMANDO: Record<ComandoGlobal, string[]> = {
  menu: ["menu", "menu inicial", "inicio", "comecar", "recomecar", "principal"],
  voltar: ["voltar", "volta", "anterior"],
  atendente: [
    "atendente",
    "humano",
    "pessoa",
    "suporte",
    "atendimento",
    "falar com atendente",
    "falar com alguem",
    "quero falar com uma pessoa",
  ],
};

/**
 * Comando global reconhecido no texto livre.
 *
 * Exige a frase inteira, não um pedaço: "menu" transfere para o início, mas
 * "quero o menu de planos de 30 dias" é resposta comum e não deveria jogar o
 * cliente de volta ao começo. A exceção é o pedido de atendente, onde a
 * palavra no meio da frase é justamente o caso a atender.
 */
export function detectarComando(texto: string): ComandoGlobal | null {
  const limpo = normalizar(texto);
  if (!limpo) return null;

  for (const [comando, palavras] of Object.entries(PALAVRAS_COMANDO) as [
    ComandoGlobal,
    string[],
  ][]) {
    if (palavras.includes(limpo)) return comando;
  }

  const pedeAtendente = PALAVRAS_COMANDO.atendente.some((palavra) =>
    new RegExp(`(^|\\s)${palavra}(\\s|$)`).test(limpo),
  );

  return pedeAtendente ? "atendente" : null;
}

/**
 * Interpreta a resposta do cliente diante das opções apresentadas.
 *
 * A opção vence o comando global: se o menu tem um botão "👨‍💻 Falar com
 * atendente", clicar nele segue o destino configurado pelo administrador em
 * vez do atalho embutido.
 */
export function interpretarEscolha(texto: string, opcoes: readonly OpcaoApresentada[]): Escolha {
  const bruto = texto.trim();
  const limpo = normalizar(bruto);

  if (!limpo && !bruto) return { tipo: "nenhuma" };

  // 1. Id ou valor exatos: é o que o botão nativo devolve.
  const porIdentidade = opcoes.findIndex(
    (opcao) => opcao.id === bruto || normalizar(opcao.valor) === limpo,
  );
  if (porIdentidade >= 0) {
    return { tipo: "opcao", opcao: opcoes[porIdentidade]!, posicao: porIdentidade + 1 };
  }

  // 2. Rótulo escrito por extenso.
  const porRotulo = opcoes.findIndex((opcao) => normalizar(opcao.rotulo) === limpo);
  if (porRotulo >= 0) {
    return { tipo: "opcao", opcao: opcoes[porRotulo]!, posicao: porRotulo + 1 };
  }

  // 3. Número da posição no menu.
  if (/^\d{1,2}$/.test(limpo)) {
    const posicao = Number(limpo);
    const opcao = opcoes[posicao - 1];
    if (opcao) return { tipo: "opcao", opcao, posicao };
  }

  const comando = detectarComando(bruto);
  if (comando) return { tipo: "comando", comando };

  // 4. Último recurso: rótulo contido no texto. Cobre "quero o plano de 90
  //    dias".
  //
  //    Casando mais de um rótulo, vence o mais longo: com as opções "TV" e
  //    "TV Box", "tenho uma tv box" é TV Box, não empate. Só empata de
  //    verdade quando os dois rótulos têm o mesmo tamanho — aí não há como
  //    escolher, e perguntar de novo é melhor do que chutar.
  const candidatos = opcoes
    .map((opcao, indice) => ({ opcao, indice, rotulo: normalizar(opcao.rotulo) }))
    .filter(({ rotulo }) => rotulo.length >= 3 && limpo.includes(rotulo))
    .sort((a, b) => b.rotulo.length - a.rotulo.length);

  const melhor = candidatos[0];
  const empate = candidatos[1] && candidatos[1].rotulo.length === melhor?.rotulo.length;

  if (melhor && !empate) {
    return { tipo: "opcao", opcao: melhor.opcao, posicao: melhor.indice + 1 };
  }

  // 5. O caminho inverso: o que o cliente escreveu está DENTRO do rótulo.
  //
  //    É o caso mais comum de resposta digitada. O rótulo do plano é
  //    "Plano 30 dias — R$ 99,90" porque o preço precisa aparecer na lista,
  //    mas ninguém digita o preço de volta: digita "Plano 30 dias".
  //
  //    Só vale quando um único rótulo casa. Com "plano" e três planos na tela
  //    não há escolha a fazer, e perguntar de novo é o certo.
  const porPrefixo = opcoes.filter(
    (opcao) => limpo.length >= 3 && normalizar(opcao.rotulo).includes(limpo),
  );

  if (porPrefixo.length === 1) {
    const unica = porPrefixo[0]!;
    return { tipo: "opcao", opcao: unica, posicao: opcoes.indexOf(unica) + 1 };
  }

  return { tipo: "nenhuma" };
}

/** Menu numerado, usado quando o provedor não suporta botão ou lista nativos. */
export function montarMenuTexto(
  mensagem: string,
  opcoes: readonly OpcaoApresentada[],
  rodape?: string,
): string {
  const linhas = opcoes.map((opcao, indice) => `${indice + 1}. ${opcao.rotulo}`);
  const partes = [mensagem.trim(), linhas.join("\n")];
  if (rodape) partes.push(rodape);
  return partes.filter(Boolean).join("\n\n");
}

/**
 * Empilha a etapa atual no histórico de navegação, sem deixar a pilha crescer
 * para sempre e sem repetir a mesma etapa duas vezes seguidas.
 */
export function empilharEtapa(historico: readonly string[], etapaId: string, limite = 20): string[] {
  if (historico.at(-1) === etapaId) return [...historico];
  return [...historico, etapaId].slice(-limite);
}

/** Desempilha para o "🔙 Voltar". Devolve a etapa anterior e o novo histórico. */
export function desempilharEtapa(historico: readonly string[]): {
  anterior: string | null;
  historico: string[];
} {
  const copia = [...historico];
  const anterior = copia.pop() ?? null;
  return { anterior, historico: copia };
}

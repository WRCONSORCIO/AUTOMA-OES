import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";

/**
 * Reconhece a equipe e a gerência que já existem antes de criar outra.
 *
 * O cadastro antigo foi digitado com o primeiro nome — "CHARLES", "ERITA",
 * "LUCAS". A planilha traz o nome completo. São as mesmas pessoas, e criar uma
 * segunda entrada para cada uma partiu a operação ao meio: as cotas ficaram na
 * antiga e os vendedores foram para a nova, de modo que a comissão de
 * supervisão passou a ser calculada sobre uma equipe com zero vendas e a
 * carteira ficou pendurada numa equipe sem ninguém.
 *
 * Daí este módulo. Antes de criar, procura-se quem já está lá:
 *
 *   - **existe só a abreviada** → ela é RENOMEADA para o nome completo. Nada se
 *     move, e é o melhor desfecho possível: cotas, comissões e histórico
 *     continuam exatamente onde estavam, com o nome certo na tela;
 *   - **existem as duas** → a abreviada é absorvida pela completa: tudo o que
 *     apontava para ela passa a apontar para a outra, e ela sai;
 *   - **existe só a completa, ou nenhuma** → o caminho normal.
 *
 * O casamento exige fronteira de palavra: "CHARLES" casa com "CHARLES
 * CARVALHO", mas "CHARLE" não casa com nada. Havendo mais de uma candidata, a
 * fusão não acontece — juntar duas equipes erradas mistura carteira de gente
 * diferente, e desfazer isso é trabalho manual venda por venda.
 */

export interface ResolucaoOrganograma {
  id: string;
  criada: boolean;
  /** Nome anterior, quando a entrada existente foi renomeada ou absorvida. */
  absorveu: string | null;
  /** Mais de uma candidata abreviada: nada foi fundido, e alguém precisa ver. */
  ambigua: string[] | null;
}

/**
 * A abreviada é o começo do nome completo, terminando em fim de palavra.
 *
 * Comparar por prefixo puro casaria "ANA" com "ANANIAS", que são pessoas
 * diferentes. A fronteira é o que separa "primeiro nome" de "pedaço de nome".
 */
export function ehAbreviacaoDe(abreviada: string, completo: string): boolean {
  const curto = normalizarTexto(abreviada);
  const longo = normalizarTexto(completo);

  if (curto === longo || curto.length === 0) return false;
  return longo.startsWith(`${curto} `);
}

export async function resolverGerencia(nome: string): Promise<ResolucaoOrganograma> {
  const exata = await prisma.gerencia.findUnique({ where: { nome }, select: { id: true } });

  const abreviadas = (
    await prisma.gerencia.findMany({ select: { id: true, nome: true } })
  ).filter((candidata) => ehAbreviacaoDe(candidata.nome, nome));

  if (abreviadas.length > 1) {
    return {
      id: exata?.id ?? (await criarGerencia(nome)),
      criada: !exata,
      absorveu: null,
      ambigua: abreviadas.map((candidata) => candidata.nome),
    };
  }

  const abreviada = abreviadas[0];

  if (exata && abreviada) {
    await fundirGerencia(abreviada.id, exata.id);
    return { id: exata.id, criada: false, absorveu: abreviada.nome, ambigua: null };
  }

  if (exata) return { id: exata.id, criada: false, absorveu: null, ambigua: null };

  if (abreviada) {
    await prisma.gerencia.update({ where: { id: abreviada.id }, data: { nome } });
    return { id: abreviada.id, criada: false, absorveu: abreviada.nome, ambigua: null };
  }

  return { id: await criarGerencia(nome), criada: true, absorveu: null, ambigua: null };
}

/**
 * A equipe é procurada em TODA a base, não só dentro da gerência de destino.
 *
 * A abreviada costuma estar pendurada na gerência abreviada — "LUCAS" sob
 * "ERITA" — e limitar a busca à gerência certa faria a duplicata escapar
 * justamente no caso que este módulo existe para resolver. A gerência da
 * equipe é corrigida junto com o nome.
 */
export async function resolverEquipe(
  nome: string,
  gerenciaId: string,
): Promise<ResolucaoOrganograma> {
  const exata = await prisma.equipe.findFirst({
    where: { nome, gerenciaId },
    select: { id: true },
  });

  const abreviadas = (
    await prisma.equipe.findMany({ select: { id: true, nome: true } })
  ).filter((candidata) => ehAbreviacaoDe(candidata.nome, nome));

  if (abreviadas.length > 1) {
    return {
      id: exata?.id ?? (await criarEquipe(nome, gerenciaId)),
      criada: !exata,
      absorveu: null,
      ambigua: abreviadas.map((candidata) => candidata.nome),
    };
  }

  const abreviada = abreviadas[0];

  if (exata && abreviada) {
    await fundirEquipe(abreviada.id, exata.id);
    return { id: exata.id, criada: false, absorveu: abreviada.nome, ambigua: null };
  }

  if (exata) return { id: exata.id, criada: false, absorveu: null, ambigua: null };

  if (abreviada) {
    await prisma.equipe.update({ where: { id: abreviada.id }, data: { nome, gerenciaId } });
    return { id: abreviada.id, criada: false, absorveu: abreviada.nome, ambigua: null };
  }

  return { id: await criarEquipe(nome, gerenciaId), criada: true, absorveu: null, ambigua: null };
}

async function criarGerencia(nome: string): Promise<string> {
  const criada = await prisma.gerencia.create({ data: { nome }, select: { id: true } });
  return criada.id;
}

async function criarEquipe(nome: string, gerenciaId: string): Promise<string> {
  const criada = await prisma.equipe.create({ data: { nome, gerenciaId }, select: { id: true } });
  return criada.id;
}

/**
 * Move tudo o que aponta para a gerência de origem e a apaga.
 *
 * Cada tabela com `gerenciaId` está aqui, e a lista precisa ficar completa:
 * deixar uma de fora não daria erro nenhum — a linha simplesmente continuaria
 * apontando para uma gerência que não existe mais, e o registro sumiria dos
 * relatórios sem aviso. O `delete` no fim é a rede de proteção: uma referência
 * esquecida vira violação de chave estrangeira, e a importação para em vez de
 * corromper.
 */
async function fundirGerencia(deId: string, paraId: string): Promise<void> {
  const onde = { where: { gerenciaId: deId }, data: { gerenciaId: paraId } };

  await prisma.$transaction([
    prisma.equipe.updateMany(onde),
    prisma.vendedor.updateMany(onde),
    prisma.usuario.updateMany(onde),
    prisma.cota.updateMany(onde),
    prisma.comissaoRegistro.updateMany(onde),
    prisma.comissaoEquipe.updateMany(onde),
    prisma.comissaoVendedorAdm.updateMany(onde),
    prisma.bonusIncentivo.updateMany(onde),
    prisma.vendedorAlocacaoHistorico.updateMany(onde),
    prisma.gerencia.delete({ where: { id: deId } }),
  ]);
}

async function fundirEquipe(deId: string, paraId: string): Promise<void> {
  const onde = { where: { equipeId: deId }, data: { equipeId: paraId } };

  await prisma.$transaction([
    prisma.vendedor.updateMany(onde),
    prisma.usuario.updateMany(onde),
    prisma.cota.updateMany(onde),
    prisma.comissaoRegistro.updateMany(onde),
    prisma.comissaoEquipe.updateMany(onde),
    prisma.comissaoVendedorAdm.updateMany(onde),
    prisma.bonusIncentivo.updateMany(onde),
    prisma.vendedorAlocacaoHistorico.updateMany(onde),
    prisma.equipe.delete({ where: { id: deId } }),
  ]);
}

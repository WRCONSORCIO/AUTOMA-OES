import { createHash } from "node:crypto";
import type { CategoriaVendedor, Prisma, SituacaoVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import {
  INICIO_DOS_TEMPOS,
  lerPlanilhaCadastro,
  montarPeriodos,
  type LinhaCategoria,
  type LinhaVendedor,
  type ProblemaLeitura,
} from "./planilha-cadastro";

/**
 * Importa o cadastro da WR: organograma, identidade e histórico de categoria.
 *
 * Esta importação é diferente das outras três. As da administradora trazem
 * FATOS — vendas, parcelas, comissões — e o sistema é obrigado a aceitá-los.
 * Esta traz o que só a WR sabe: quem é quem, sob qual supervisão, e desde
 * quando cada um é iniciante, veterano ou expert. É a metade da verdade que
 * não vem em relatório nenhum.
 *
 * A peça que faz tudo encaixar é o de-para de nomes. O relatório da SERVOPA
 * identifica o vendedor por CPF/CNPJ e por um nome próprio dela; o cadastro de
 * vocês usa outro nome. Sem a tradução, cada documento da administradora vira
 * um vendedor solto, e a mesma pessoa aparece três vezes — uma por login.
 *
 * **Não cria documento nenhum.** Os CPFs e CNPJs já existem: nasceram da
 * importação da base, com o nome que a administradora usa. O que esta
 * importação faz é AMARRAR esses documentos à pessoa certa e ao lugar certo do
 * organograma. Documento que a planilha cita e o sistema não tem vira
 * pendência, nunca cadastro novo — inventar um documento sem número seria
 * criar um vendedor que nenhuma venda jamais encontraria.
 *
 * Reimportar é seguro. As linhas que esta importação escreve ficam marcadas, e
 * na próxima passada só elas são refeitas: correção feita à mão na tela
 * sobrevive.
 */

export const MOTIVO_DA_IMPORTACAO = "Importação da planilha de cadastro";

export type MotivoPendencia =
  | "DOCUMENTO_NAO_ENCONTRADO"
  | "DOCUMENTO_AMBIGUO"
  | "VENDEDOR_SEM_LOGIN"
  | "VENDEDOR_DESCONHECIDO"
  | "GERENCIA_DIVERGENTE"
  | "PESSOA_AMBIGUA"
  | "SEGUNDO_CPF";

export interface Pendencia {
  motivo: MotivoPendencia;
  /** O nome como está escrito na planilha. */
  referencia: string;
  detalhe: string;
}

export interface ResumoCadastro {
  totalLinhas: number;
  gerenciasCriadas: number;
  equipesCriadas: number;
  pessoasCriadas: number;
  pessoasExistentes: number;
  documentosVinculados: number;
  alocacoesAtualizadas: number;
  situacoesAtualizadas: number;
  periodosDeCategoria: number;
  /** Vendedores da planilha que casaram com pelo menos um documento. */
  vendedoresConciliados: number;
  problemas: ProblemaLeitura[];
  pendencias: Pendencia[];
}

interface EntradaImportacao {
  arquivo: Buffer;
  nomeArquivo: string;
  usuario: ContextoUsuario;
}

export async function importarCadastroXlsx(
  entrada: EntradaImportacao,
): Promise<ResumoCadastro> {
  const planilha = lerPlanilhaCadastro(entrada.arquivo);
  const pendencias: Pendencia[] = [];

  const importacao = await prisma.importacao.create({
    data: {
      tipo: "CADASTRO_XLSX",
      nomeArquivo: entrada.nomeArquivo,
      tamanhoBytes: entrada.arquivo.byteLength,
      hashArquivo: createHash("sha256").update(entrada.arquivo).digest("hex"),
      status: "PROCESSANDO",
      usuarioId: entrada.usuario.id,
      usuarioNome: entrada.usuario.nome,
    },
    select: { id: true },
  });

  try {
    const organograma = await montarOrganograma(planilha.vendedores, pendencias);
    const pessoas = await garantirPessoas(planilha.vendedores, pendencias);
    const documentos = await conciliarDocumentos(planilha, pessoas, pendencias);

    const alocacoes = await aplicarAlocacao(
      planilha.vendedores,
      pessoas,
      documentos,
      organograma,
      entrada.usuario,
    );

    const categorias = await aplicarCategorias(
      planilha.categorias,
      planilha.vendedores,
      pessoas,
      documentos,
      pendencias,
      entrada.usuario,
    );

    const resumo: ResumoCadastro = {
      totalLinhas:
        planilha.vendedores.length + planilha.categorias.length + planilha.nomes.length,
      gerenciasCriadas: organograma.gerenciasCriadas,
      equipesCriadas: organograma.equipesCriadas,
      pessoasCriadas: pessoas.criadas,
      pessoasExistentes: pessoas.porNome.size - pessoas.criadas,
      documentosVinculados: documentos.vinculados,
      alocacoesAtualizadas: alocacoes.alocacoes,
      situacoesAtualizadas: alocacoes.situacoes,
      periodosDeCategoria: categorias,
      vendedoresConciliados: documentos.porVendedorDaPlanilha.size,
      problemas: planilha.problemas,
      pendencias,
    };

    await prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status:
          planilha.problemas.length > 0 || pendencias.length > 0
            ? "CONCLUIDA_COM_ERROS"
            : "CONCLUIDA",
        totalLinhas: resumo.totalLinhas,
        qtdErros: planilha.problemas.length + pendencias.length,
        finalizadoEm: new Date(),
        resumo: resumo as unknown as Prisma.InputJsonValue,
      },
    });

    await registrarAuditoria({
      acao: "IMPORTACAO",
      entidade: "Importacao",
      entidadeId: importacao.id,
      descricao:
        `Cadastro importado de ${entrada.nomeArquivo}: ` +
        `${resumo.pessoasCriadas} pessoa(s) criada(s), ` +
        `${resumo.documentosVinculados} documento(s) vinculado(s), ` +
        `${resumo.periodosDeCategoria} período(s) de categoria, ` +
        `${resumo.pendencias.length} pendência(s).`,
      dadosDepois: resumo as unknown as Prisma.InputJsonValue,
      usuario: entrada.usuario,
    });

    return resumo;
  } catch (erro) {
    await prisma.importacao.update({
      where: { id: importacao.id },
      data: { status: "FALHA", finalizadoEm: new Date() },
    });
    await prisma.importacaoErro.create({
      data: {
        importacaoId: importacao.id,
        mensagem: erro instanceof Error ? erro.message : String(erro),
      },
    });
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Organograma
// ---------------------------------------------------------------------------

interface Organograma {
  gerenciaPorNome: Map<string, string>;
  equipePorNome: Map<string, string>;
  gerenciasCriadas: number;
  equipesCriadas: number;
}

/**
 * Gerências e equipes, a partir de quem aparece como GERENTE e SUPERVISOR.
 *
 * A planilha não tem uma aba de estrutura: a estrutura está implícita em quem
 * é citado nas colunas de chefia. É a forma certa de manter — uma lista
 * separada de equipes seria uma segunda verdade a divergir da primeira.
 *
 * Um supervisor citado sob duas gerências diferentes vira UMA equipe, sob a
 * gerência da maioria das linhas dele, e a divergência é reportada. Criar duas
 * equipes homônimas seria pior: a comissão de supervisão sairia partida em
 * duas linhas na tela de pagamento, sem que ninguém entendesse por quê.
 */
async function montarOrganograma(
  vendedores: readonly LinhaVendedor[],
  pendencias: Pendencia[],
): Promise<Organograma> {
  const gerenciaPorNome = new Map<string, string>();
  const equipePorNome = new Map<string, string>();
  let gerenciasCriadas = 0;
  let equipesCriadas = 0;

  const nomesDeGerencia = [
    ...new Set(vendedores.map((linha) => linha.gerente).filter((nome): nome is string => !!nome)),
  ];

  for (const nome of nomesDeGerencia) {
    const existente = await prisma.gerencia.findUnique({ where: { nome }, select: { id: true } });
    if (existente) {
      gerenciaPorNome.set(normalizarTexto(nome), existente.id);
      continue;
    }

    const criada = await prisma.gerencia.create({ data: { nome }, select: { id: true } });
    gerenciaPorNome.set(normalizarTexto(nome), criada.id);
    gerenciasCriadas += 1;
  }

  // Gerência de cada supervisor: a que aparece em mais linhas dele.
  const votos = new Map<string, Map<string, number>>();
  for (const linha of vendedores) {
    if (!linha.supervisor || !linha.gerente) continue;
    const chave = normalizarTexto(linha.supervisor);
    const contagem = votos.get(chave) ?? new Map<string, number>();
    contagem.set(linha.gerente, (contagem.get(linha.gerente) ?? 0) + 1);
    votos.set(chave, contagem);
  }

  for (const linha of vendedores) {
    if (!linha.supervisor) continue;
    const chave = normalizarTexto(linha.supervisor);
    if (equipePorNome.has(chave)) continue;

    const contagem = votos.get(chave);
    if (!contagem || contagem.size === 0) continue;

    const ordenado = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const gerenteEscolhido = ordenado[0]?.[0];
    if (!gerenteEscolhido) continue;

    if (ordenado.length > 1) {
      pendencias.push({
        motivo: "GERENCIA_DIVERGENTE",
        referencia: linha.supervisor,
        detalhe:
          `Aparece sob mais de uma gerência (${ordenado.map(([nome, qtd]) => `${nome}: ${qtd} linha(s)`).join(", ")}). ` +
          `A equipe foi criada sob ${gerenteEscolhido}. Confira as linhas divergentes na planilha.`,
      });
    }

    const gerenciaId = gerenciaPorNome.get(normalizarTexto(gerenteEscolhido));
    if (!gerenciaId) continue;

    const existente = await prisma.equipe.findFirst({
      where: { nome: linha.supervisor, gerenciaId },
      select: { id: true },
    });

    if (existente) {
      equipePorNome.set(chave, existente.id);
      continue;
    }

    const criada = await prisma.equipe.create({
      data: { nome: linha.supervisor, gerenciaId },
      select: { id: true },
    });
    equipePorNome.set(chave, criada.id);
    equipesCriadas += 1;
  }

  return { gerenciaPorNome, equipePorNome, gerenciasCriadas, equipesCriadas };
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

interface Pessoas {
  porNome: Map<string, string>;
  criadas: number;
}

/**
 * Uma Pessoa por linha da aba VENDEDORES.
 *
 * A Pessoa é a identidade única: é ela que junta o CPF e os CNPJs numa carteira
 * só, e é por ela que a tela de estornos e a de pagamento somam. O nome da
 * planilha é a chave — não há documento na aba, e não haveria como haver: uma
 * pessoa tem vários.
 *
 * Duas pessoas cadastradas com o mesmo nome no sistema param a linha em vez de
 * escolher uma. Escolher errado aqui juntaria a carteira de duas pessoas
 * diferentes, e desfazer isso depois é trabalho manual venda por venda.
 */
async function garantirPessoas(
  vendedores: readonly LinhaVendedor[],
  pendencias: Pendencia[],
): Promise<Pessoas> {
  const porNome = new Map<string, string>();
  let criadas = 0;

  for (const linha of vendedores) {
    const chave = normalizarTexto(linha.nome);
    if (porNome.has(chave)) continue;

    const encontradas = await prisma.pessoa.findMany({
      where: { nome: linha.nome },
      select: { id: true },
      take: 2,
    });

    if (encontradas.length > 1) {
      pendencias.push({
        motivo: "PESSOA_AMBIGUA",
        referencia: linha.nome,
        detalhe:
          "Há mais de uma pessoa cadastrada com este nome. Resolva em Comercial → Pessoas " +
          "antes de importar, senão os documentos iriam para a carteira errada.",
      });
      continue;
    }

    const unica = encontradas[0];
    if (unica) {
      porNome.set(chave, unica.id);
      continue;
    }

    const criada = await prisma.pessoa.create({
      data: { nome: linha.nome, observacoes: linha.observacao },
      select: { id: true },
    });
    porNome.set(chave, criada.id);
    criadas += 1;
  }

  return { porNome, criadas };
}

// ---------------------------------------------------------------------------
// De-para de nomes
// ---------------------------------------------------------------------------

interface Documentos {
  /** Nome do vendedor na planilha → documentos dele no sistema. */
  porVendedorDaPlanilha: Map<string, string[]>;
  vinculados: number;
}

/**
 * Liga cada documento da administradora à pessoa certa.
 *
 * O nome que a planilha traz vem do relatório impresso, que **corta em 30
 * caracteres**: "42.505.181 JULIA MARIANNE OLIV" é a mesma pessoa que a base
 * chama de "42.505.181 JULIA MARIANNE OLIVEIRA DA PAIXAO". Por isso a busca
 * tem três degraus, do mais seguro ao mais tolerante:
 *
 *   1. nome idêntico;
 *   2. o nome da planilha é começo de exatamente UM nome do sistema;
 *   3. a raiz do CNPJ embutida no nome bate com um documento.
 *
 * Mais de um candidato nunca é resolvido por desempate: vira pendência. Um
 * vínculo errado aqui manda a comissão de uma pessoa para outra.
 */
async function conciliarDocumentos(
  planilha: { nomes: readonly { nomeRelatorio: string; vendedorWr: string | null }[] },
  pessoas: Pessoas,
  pendencias: Pendencia[],
): Promise<Documentos> {
  const cadastrados = await prisma.vendedor.findMany({
    select: { id: true, nome: true, cpfCnpj: true, pessoaId: true },
  });

  const porNomeExato = new Map<string, typeof cadastrados>();
  for (const vendedor of cadastrados) {
    const chave = normalizarTexto(vendedor.nome);
    porNomeExato.set(chave, [...(porNomeExato.get(chave) ?? []), vendedor]);
  }

  const porVendedorDaPlanilha = new Map<string, string[]>();
  let vinculados = 0;

  for (const linha of planilha.nomes) {
    if (!linha.vendedorWr) continue;

    const pessoaId = pessoas.porNome.get(normalizarTexto(linha.vendedorWr));
    if (!pessoaId) {
      pendencias.push({
        motivo: "VENDEDOR_DESCONHECIDO",
        referencia: linha.vendedorWr,
        detalhe:
          `Citado no de-para de "${linha.nomeRelatorio}", mas não existe na aba VENDEDORES. ` +
          "Acrescente a linha lá ou corrija o nome.",
      });
      continue;
    }

    const candidatos = localizarDocumentos(linha.nomeRelatorio, porNomeExato, cadastrados);

    if (candidatos.length === 0) {
      pendencias.push({
        motivo: "DOCUMENTO_NAO_ENCONTRADO",
        referencia: linha.nomeRelatorio,
        detalhe:
          `Nenhum documento com este nome no sistema. Normal quando o vendedor ainda não ` +
          `teve venda importada — o vínculo passa a valer sozinho na próxima base.`,
      });
      continue;
    }

    if (candidatos.length > 1) {
      pendencias.push({
        motivo: "DOCUMENTO_AMBIGUO",
        referencia: linha.nomeRelatorio,
        detalhe:
          `Casa com ${candidatos.length} documentos (${candidatos.map((c) => c.cpfCnpj).join(", ")}). ` +
          "Escreva o nome completo na planilha para desempatar.",
      });
      continue;
    }

    const documento = candidatos[0]!;
    const chaveVendedor = normalizarTexto(linha.vendedorWr);
    porVendedorDaPlanilha.set(chaveVendedor, [
      ...(porVendedorDaPlanilha.get(chaveVendedor) ?? []),
      documento.id,
    ]);

    if (documento.pessoaId === pessoaId) continue;

    try {
      await prisma.$transaction([
        prisma.vendedor.update({ where: { id: documento.id }, data: { pessoaId } }),
        prisma.pessoaVinculoHistorico.create({
          data: {
            pessoaId,
            vendedorId: documento.id,
            vendedorNome: documento.nome,
            vendedorDocumento: documento.cpfCnpj,
            acao: "VINCULO",
            motivo: MOTIVO_DA_IMPORTACAO,
            automatico: true,
          },
        }),
      ]);

      vinculados += 1;
    } catch (erro) {
      // Uma pessoa tem vários CNPJs, mas um só CPF — o banco garante isso, e
      // está certo: dois CPFs na mesma pessoa quase sempre são duas pessoas
      // diferentes com nomes parecidos, e juntá-las misturaria duas carteiras.
      // A linha vira pendência e as outras 100 seguem: abortar a importação
      // inteira por causa de um de-para errado seria trocar um problema
      // pequeno por nenhum cadastro.
      if (!ePessoaComDoisCpfs(erro)) throw erro;

      pendencias.push({
        motivo: "SEGUNDO_CPF",
        referencia: linha.nomeRelatorio,
        detalhe:
          `O CPF ${documento.cpfCnpj} não pôde ser ligado a ${linha.vendedorWr}: essa pessoa já ` +
          `tem outro CPF vinculado. Confira se não são duas pessoas diferentes de nome parecido.`,
      });
    }
  }

  return { porVendedorDaPlanilha, vinculados };
}

/** Violação da regra "um CPF por pessoa" do banco. */
function ePessoaComDoisCpfs(erro: unknown): boolean {
  return (
    typeof erro === "object" &&
    erro !== null &&
    "code" in erro &&
    (erro as { code?: unknown }).code === "P2002"
  );
}

type VendedorCadastrado = { id: string; nome: string; cpfCnpj: string; pessoaId: string | null };

function localizarDocumentos(
  nomeRelatorio: string,
  porNomeExato: Map<string, VendedorCadastrado[]>,
  cadastrados: readonly VendedorCadastrado[],
): VendedorCadastrado[] {
  const alvo = normalizarTexto(nomeRelatorio);

  const exatos = porNomeExato.get(alvo);
  if (exatos && exatos.length > 0) return exatos;

  const porPrefixo = cadastrados.filter((vendedor) =>
    normalizarTexto(vendedor.nome).startsWith(alvo),
  );
  if (porPrefixo.length > 0) return porPrefixo;

  // A administradora prefixa o nome PJ com a raiz do CNPJ. Quando ela está
  // escrita, é a identificação mais forte que existe nesta planilha — melhor
  // que o nome, que vem cortado.
  const raiz = /^(\d{2})\.(\d{3})\.(\d{3})\b/.exec(nomeRelatorio.trim());
  if (raiz) {
    const digitos = `${raiz[1]}${raiz[2]}${raiz[3]}`;
    return cadastrados.filter((vendedor) => vendedor.cpfCnpj.startsWith(digitos));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Alocação e situação
// ---------------------------------------------------------------------------

/**
 * Equipe, gerência e situação de cada documento.
 *
 * Vai para o DOCUMENTO, não para a pessoa: é o documento que aparece na venda,
 * e é por ele que a comissão de supervisão e gerência é atribuída.
 *
 * O período de alocação criado aqui é aberto e sem data de início própria — a
 * planilha não diz desde quando a pessoa está naquela equipe. Usar a data de
 * hoje inventaria uma movimentação que não houve; a vigência começa no início
 * dos tempos, e movimentações reais entram depois pela tela, que sabe a data.
 */
async function aplicarAlocacao(
  vendedores: readonly LinhaVendedor[],
  pessoas: Pessoas,
  documentos: Documentos,
  organograma: Organograma,
  usuario: ContextoUsuario,
): Promise<{ alocacoes: number; situacoes: number }> {
  let alocacoes = 0;
  let situacoes = 0;

  for (const linha of vendedores) {
    const chave = normalizarTexto(linha.nome);
    const ids = documentos.porVendedorDaPlanilha.get(chave) ?? [];
    if (ids.length === 0) continue;

    const equipeId = linha.supervisor
      ? (organograma.equipePorNome.get(normalizarTexto(linha.supervisor)) ?? null)
      : null;
    const gerenciaId = linha.gerente
      ? (organograma.gerenciaPorNome.get(normalizarTexto(linha.gerente)) ?? null)
      : null;

    for (const vendedorId of ids) {
      const atual = await prisma.vendedor.findUniqueOrThrow({
        where: { id: vendedorId },
        select: { equipeId: true, gerenciaId: true, situacao: true },
      });

      if (atual.equipeId !== equipeId || atual.gerenciaId !== gerenciaId) {
        await gravarAlocacao(vendedorId, equipeId, gerenciaId, usuario);
        alocacoes += 1;
      }

      if (atual.situacao !== linha.situacao) {
        await prisma.vendedor.update({
          where: { id: vendedorId },
          data: { situacao: linha.situacao as SituacaoVendedor },
        });
        situacoes += 1;
      }
    }
  }

  void pessoas;
  return { alocacoes, situacoes };
}

async function gravarAlocacao(
  vendedorId: string,
  equipeId: string | null,
  gerenciaId: string | null,
  usuario: ContextoUsuario,
): Promise<void> {
  await prisma.$transaction([
    // Só o que esta importação escreveu é refeito. Movimentação registrada à
    // mão na tela tem data real e não pode ser apagada por um arquivo que não
    // sabe quando as coisas aconteceram.
    prisma.vendedorAlocacaoHistorico.deleteMany({
      where: { vendedorId, motivo: MOTIVO_DA_IMPORTACAO },
    }),
    prisma.vendedorAlocacaoHistorico.create({
      data: {
        vendedorId,
        equipeId,
        gerenciaId,
        vigenteDe: INICIO_DOS_TEMPOS,
        motivo: MOTIVO_DA_IMPORTACAO,
        usuarioId: usuario.id,
      },
    }),
    prisma.vendedor.update({ where: { id: vendedorId }, data: { equipeId, gerenciaId } }),
  ]);
}

// ---------------------------------------------------------------------------
// Histórico de categoria
// ---------------------------------------------------------------------------

/**
 * Transforma as linhas de mudança em períodos fechados, e grava por documento.
 *
 * A planilha dá o começo de cada trecho; o fim é a véspera do começo do
 * próximo. O último fica aberto.
 *
 * **O histórico da planilha é da PESSOA, e é aplicado a todos os documentos
 * dela.** Não é descuido: é como a WR opera. Quando o iniciante vira veterano
 * ele abre o CNPJ e para de vender no CPF; quando vira expert abre outro CNPJ
 * e segue vendendo pelo de veterano. Em qualquer data, a pessoa tem UMA
 * categoria, e o documento que estava vendendo naquele momento tinha a mesma.
 * Repetir a linha do tempo em cada documento dá a resposta certa para toda
 * venda que existe de verdade.
 *
 * Como na alocação, só as linhas desta importação são refeitas a cada passada.
 */
async function aplicarCategorias(
  categorias: readonly LinhaCategoria[],
  vendedores: readonly LinhaVendedor[],
  pessoas: Pessoas,
  documentos: Documentos,
  pendencias: Pendencia[],
  usuario: ContextoUsuario,
): Promise<number> {
  const conhecidos = new Set(vendedores.map((linha) => normalizarTexto(linha.nome)));
  const porVendedor = new Map<string, LinhaCategoria[]>();

  for (const linha of categorias) {
    const chave = normalizarTexto(linha.vendedor);
    if (!conhecidos.has(chave)) {
      pendencias.push({
        motivo: "VENDEDOR_DESCONHECIDO",
        referencia: linha.vendedor,
        detalhe: `Tem histórico de categoria (${linha.mes}) mas não está na aba VENDEDORES.`,
      });
      continue;
    }
    porVendedor.set(chave, [...(porVendedor.get(chave) ?? []), linha]);
  }

  let gravados = 0;

  for (const linha of vendedores) {
    const chave = normalizarTexto(linha.nome);
    const ids = documentos.porVendedorDaPlanilha.get(chave) ?? [];

    if (ids.length === 0) {
      pendencias.push({
        motivo: "VENDEDOR_SEM_LOGIN",
        referencia: linha.nome,
        detalhe:
          "Nenhum documento da administradora ficou ligado a este vendedor. A categoria e a " +
          "equipe não têm onde ser gravadas — falta a linha dele na aba NOMES DE CADASTRO.",
      });
      continue;
    }

    const periodos = montarPeriodos(porVendedor.get(chave) ?? [], linha.categoriaAtual);
    if (periodos.length === 0) continue;

    const pessoaId = pessoas.porNome.get(chave) ?? null;

    for (const vendedorId of ids) {
      await prisma.$transaction([
        prisma.vendedorCategoriaHistorico.deleteMany({
          where: { vendedorId, motivo: MOTIVO_DA_IMPORTACAO },
        }),
        prisma.vendedorCategoriaHistorico.createMany({
          data: periodos.map((periodo) => ({
            pessoaId,
            vendedorId,
            categoria: periodo.categoria,
            vigenteDe: periodo.vigenteDe,
            vigenteAte: periodo.vigenteAte,
            motivo: MOTIVO_DA_IMPORTACAO,
            usuarioId: usuario.id,
          })),
        }),
        prisma.vendedor.update({
          where: { id: vendedorId },
          data: { categoriaAtual: periodos[periodos.length - 1]!.categoria },
        }),
      ]);

      gravados += periodos.length;
    }
  }

  return gravados;
}

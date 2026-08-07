import "server-only";

import type { CategoriaVendedor, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolverCategoriaNaData } from "@/server/domain/regras";
import {
  agruparSugestoes,
  type Confianca,
} from "@/server/domain/vinculo-nomes";
import { registrarAuditoria } from "./auditoria";
import type { ContextoUsuario } from "./vendedores";
import {
  podeAcrescentarDocumento,
  tipoDoDocumento,
  type DocumentoDaPessoa as DocumentoParaLimite,
} from "@/modules/comercial/domain/rules/documentos";

type Cliente = Prisma.TransactionClient | PrismaClient;

/**
 * A pessoa agrupa os cadastros de vendedor de um mesmo indivíduo.
 *
 * O vendedor entra vendendo no CPF e passa a operar por CNPJ ao mudar de
 * categoria, então a mesma pessoa acumula vários documentos. Categoria e
 * recuperação pertencem ao DOCUMENTO — o CPF pode ser iniciante enquanto o CNPJ
 * já é veterano. A pessoa é a unidade de identidade e de consolidação; o
 * documento é a unidade de operação, cálculo e pagamento.
 *
 * Nada aqui altera venda já gravada: categoria e recuperação da venda são
 * fotografias tiradas na importação e permanecem intocadas.
 */

export async function criarPessoaParaVendedor(
  vendedor: { id: string; nome: string; cpfCnpj: string },
  db: Cliente = prisma,
  usuario?: ContextoUsuario,
): Promise<string> {
  const pessoa = await db.pessoa.create({ data: { nome: vendedor.nome } });

  await db.vendedor.update({
    where: { id: vendedor.id },
    data: { pessoaId: pessoa.id },
  });

  await db.pessoaVinculoHistorico.create({
    data: {
      pessoaId: pessoa.id,
      vendedorId: vendedor.id,
      vendedorNome: vendedor.nome,
      vendedorDocumento: vendedor.cpfCnpj,
      acao: "VINCULO",
      motivo: "Pessoa criada junto com o cadastro",
      automatico: !usuario,
      usuarioId: usuario?.id ?? null,
      usuarioNome: usuario?.nome ?? null,
    },
  });

  return pessoa.id;
}

/**
 * Liga um cadastro recém-criado a uma pessoa que já existe — o caso do
 * vendedor que abre CNPJ e já tinha o cadastro no CPF.
 */
export async function vincularAPessoaExistente(
  db: Cliente,
  vendedor: { id: string; nome: string; cpfCnpj: string },
  pessoaId: string,
  usuario: ContextoUsuario,
): Promise<string> {
  const pessoa = await db.pessoa.findUnique({
    where: { id: pessoaId },
    select: { id: true },
  });
  if (!pessoa) throw new Error("Pessoa informada não foi encontrada.");

  await db.vendedor.update({
    where: { id: vendedor.id },
    data: { pessoaId },
  });

  await db.pessoaVinculoHistorico.create({
    data: {
      pessoaId,
      vendedorId: vendedor.id,
      vendedorNome: vendedor.nome,
      vendedorDocumento: vendedor.cpfCnpj,
      acao: "VINCULO",
      motivo: "Documento adicional cadastrado para a mesma pessoa",
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
    },
  });

  return pessoaId;
}

/**
 * Espelha nos documentos da pessoa a categoria que vale HOJE.
 *
 * `categoriaAtual` é um atalho de leitura para as telas; a verdade é o
 * histórico. Resolver pela data — em vez de pegar o último período cadastrado —
 * evita dois enganos:
 *
 * - um período que começa no futuro não pode valer hoje;
 * - dois períodos que começam no mesmo dia (o cadastro nasce Iniciante e a
 *   categoria é trocada no mesmo dia) não podem ser desempatados por ordem de
 *   chegada. Era o que fazia a troca "não salvar".
 */
export async function sincronizarCategoriaAtual(
  db: Cliente,
  vendedorId: string,
): Promise<CategoriaVendedor | null> {
  const historico = await db.vendedorCategoriaHistorico.findMany({
    where: { vendedorId },
    select: { categoria: true, vigenteDe: true, vigenteAte: true },
    orderBy: { vigenteDe: "asc" },
  });

  const categoria = resolverCategoriaNaData(historico, new Date());
  if (!categoria) return null;

  // Só o documento. Propagar para os irmãos apagaria a diferença entre o CPF
  // iniciante e o CNPJ veterano, que é justamente o que a trilha cria.
  await db.vendedor.update({ where: { id: vendedorId }, data: { categoriaAtual: categoria } });
  return categoria;
}

// ---------------------------------------------------------------------------
// Sugestões de vínculo
// ---------------------------------------------------------------------------

export interface DocumentoSugerido {
  vendedorId: string;
  pessoaId: string;
  nome: string;
  cpfCnpj: string;
  tipo: "CPF" | "CNPJ" | "OUTRO";
  categoriaAtual: string;
  equipeNome: string | null;
  gerenciaNome: string | null;
  cotas: number;
}

export interface SugestaoVinculo {
  chave: string;
  confianca: Confianca;
  motivos: string[];
  documentos: DocumentoSugerido[];
}

function tipoDocumento(cpfCnpj: string): "CPF" | "CNPJ" | "OUTRO" {
  if (cpfCnpj.length === 11) return "CPF";
  if (cpfCnpj.length === 14) return "CNPJ";
  return "OUTRO";
}

/**
 * Sugere quais cadastros são a mesma pessoa.
 *
 * Varre TODOS os cadastros, inclusive os que estão pendentes de cadastro — o
 * vendedor criado pela importação é justamente o que mais precisa ser
 * reconhecido, porque nasce sem categoria e sem equipe.
 *
 * O reconhecimento de nomes está em `domain/vinculo-nomes`. Aqui só se junta o
 * resultado com os dados do cadastro. A sugestão nunca vincula sozinha.
 */
export async function sugerirVinculos(): Promise<SugestaoVinculo[]> {
  const vendedores = await prisma.vendedor.findMany({
    select: {
      id: true,
      nome: true,
      cpfCnpj: true,
      pessoaId: true,
      categoriaAtual: true,
      equipe: { select: { nome: true } },
      gerencia: { select: { nome: true } },
      _count: { select: { cotasEfetivas: true } },
    },
    orderBy: { nome: "asc" },
  });

  const porId = new Map(vendedores.map((vendedor) => [vendedor.id, vendedor]));

  const grupos = agruparSugestoes(
    vendedores.map((vendedor) => ({
      id: vendedor.id,
      nome: vendedor.nome,
      cpfCnpj: vendedor.cpfCnpj,
      pessoaId: vendedor.pessoaId,
    })),
  );

  return grupos.map((grupo) => ({
    chave: grupo.chave,
    confianca: grupo.confianca,
    motivos: grupo.motivos,
    documentos: grupo.vendedorIds
      .map((id) => porId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      // CPF primeiro: é por onde o vendedor começou e onde mora o histórico.
      .sort((a, b) => a.cpfCnpj.length - b.cpfCnpj.length || a.nome.localeCompare(b.nome))
      .map((item) => ({
        vendedorId: item.id,
        pessoaId: item.pessoaId ?? "",
        nome: item.nome,
        cpfCnpj: item.cpfCnpj,
        tipo: tipoDocumento(item.cpfCnpj),
        categoriaAtual: item.categoriaAtual,
        equipeNome: item.equipe?.nome ?? null,
        gerenciaNome: item.gerencia?.nome ?? null,
        cotas: item._count.cotasEfetivas,
      })),
  }));
}

export interface ResultadoVinculoEmLote {
  gruposVinculados: number;
  documentosVinculados: number;
  gruposIgnorados: number;
}

/**
 * Aplica de uma vez as sugestões cuja confiança dispensa conferência caso a caso.
 *
 * Existe porque conferir centenas de cadastros um a um é inviável. Nada aqui é
 * irreversível: cada vínculo entra no histórico da pessoa e pode ser desfeito
 * pela tela, documento por documento.
 */
export async function vincularSugestoesEmLote(
  entrada: { confiancas: Confianca[]; motivo: string },
  usuario: ContextoUsuario,
): Promise<ResultadoVinculoEmLote> {
  const aceitas = new Set(entrada.confiancas);
  const sugestoes = await sugerirVinculos();

  const resultado: ResultadoVinculoEmLote = {
    gruposVinculados: 0,
    documentosVinculados: 0,
    gruposIgnorados: 0,
  };

  for (const sugestao of sugestoes) {
    if (!aceitas.has(sugestao.confianca)) {
      resultado.gruposIgnorados += 1;
      continue;
    }

    // Destino: o CPF com mais vendas — onde o histórico da pessoa costuma estar.
    const destino = [...sugestao.documentos].sort(
      (a, b) => a.cpfCnpj.length - b.cpfCnpj.length || b.cotas - a.cotas,
    )[0];
    if (!destino?.pessoaId) {
      resultado.gruposIgnorados += 1;
      continue;
    }

    const vinculo = await vincularDocumentos(
      {
        vendedorIds: sugestao.documentos.map((documento) => documento.vendedorId),
        pessoaDestinoId: destino.pessoaId,
        motivo: `${entrada.motivo} — ${sugestao.motivos.join("; ")}`,
      },
      usuario,
    );

    resultado.gruposVinculados += 1;
    resultado.documentosVinculados += vinculo.documentosVinculados;
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Vínculo e separação
// ---------------------------------------------------------------------------

export interface ResultadoVinculo {
  pessoaId: string;
  documentosVinculados: number;
}

/**
 * Junta os cadastros informados sob uma única pessoa.
 *
 * A pessoa de destino recebe os documentos e também os períodos de categoria e
 * recuperação das pessoas de origem — o histórico é somado, não substituído.
 * Pessoas que ficam sem documento são preservadas para não quebrar o histórico
 * de vínculos, mas deixam de aparecer nas listagens.
 */
export async function vincularDocumentos(
  entrada: { vendedorIds: string[]; pessoaDestinoId?: string; motivo: string },
  usuario: ContextoUsuario,
): Promise<ResultadoVinculo> {
  const motivo = entrada.motivo.trim();
  if (!motivo) throw new Error("Informe o motivo do vínculo.");
  if (entrada.vendedorIds.length < 2 && !entrada.pessoaDestinoId) {
    throw new Error("Selecione ao menos dois cadastros para vincular.");
  }

  const vendedores = await prisma.vendedor.findMany({
    where: { id: { in: entrada.vendedorIds } },
    select: { id: true, nome: true, cpfCnpj: true, pessoaId: true },
  });

  if (vendedores.length !== entrada.vendedorIds.length) {
    throw new Error("Algum cadastro selecionado não foi encontrado.");
  }

  // Destino: o informado ou, por padrão, a pessoa do primeiro documento —
  // normalmente o CPF, que é por onde o vendedor começou.
  const destinoId =
    entrada.pessoaDestinoId ?? vendedores[0]?.pessoaId ?? null;
  if (!destinoId) {
    throw new Error("Não foi possível determinar a pessoa de destino.");
  }

  const origens = [
    ...new Set(
      vendedores
        .map((vendedor) => vendedor.pessoaId)
        .filter((id): id is string => Boolean(id) && id !== destinoId),
    ),
  ];

  // Uma pessoa opera por no máximo 1 CPF e 2 CNPJs — é a trilha inteira.
  // Estourar o teto quase sempre significa que dois homônimos foram tomados
  // por uma pessoa só, e o estrago disso é somar a carteira de duas pessoas
  // diferentes num consolidado que decide promoção.
  const jaNaPessoa = await prisma.vendedor.findMany({
    where: { pessoaId: destinoId, id: { notIn: entrada.vendedorIds } },
    select: { id: true, cpfCnpj: true, tipoDocumento: true },
  });

  const acumulados: DocumentoParaLimite[] = jaNaPessoa.map((doc) => ({
    id: doc.id,
    cpfCnpj: doc.cpfCnpj,
    tipo: doc.tipoDocumento,
    categoriaAtual: null,
    encerradoParaVendaEm: null,
  }));

  for (const vendedor of vendedores) {
    const tipo = tipoDoDocumento(vendedor.cpfCnpj);
    if (!tipo) {
      throw new Error(
        `Documento ${vendedor.cpfCnpj} não é CPF nem CNPJ — verifique o cadastro antes de vincular.`,
      );
    }
    const permitido = podeAcrescentarDocumento(acumulados, tipo);
    if (!permitido.ok) throw new Error(permitido.erro.mensagem);
    acumulados.push({
      id: vendedor.id,
      cpfCnpj: vendedor.cpfCnpj,
      tipo,
      categoriaAtual: null,
      encerradoParaVendaEm: null,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const vendedor of vendedores) {
      if (vendedor.pessoaId === destinoId) continue;

      await tx.vendedor.update({
        where: { id: vendedor.id },
        data: { pessoaId: destinoId },
      });

      await tx.pessoaVinculoHistorico.create({
        data: {
          pessoaId: destinoId,
          vendedorId: vendedor.id,
          vendedorNome: vendedor.nome,
          vendedorDocumento: vendedor.cpfCnpj,
          acao: "VINCULO",
          motivo,
          usuarioId: usuario.id,
          usuarioNome: usuario.nome,
        },
      });
    }

    if (origens.length > 0) {
      // Categoria e recuperação seguem os documentos para a pessoa de destino.
      await tx.vendedorCategoriaHistorico.updateMany({
        where: { pessoaId: { in: origens } },
        data: { pessoaId: destinoId },
      });
      await tx.vendedorRecuperacao.updateMany({
        where: { pessoaId: { in: origens } },
        data: { pessoaId: destinoId },
      });
    }

    // Cada documento MANTÉM a sua categoria. Vincular à mesma pessoa não
    // unifica categoria: é exatamente o caso do CPF iniciante e do CNPJ
    // veterano, que só existem como documentos da mesma pessoa. Antes isso
    // nivelava todo mundo pela categoria da pessoa, o que agora apagaria a
    // trilha de progressão.
    for (const vendedor of vendedores) {
      await sincronizarCategoriaAtual(tx, vendedor.id);
    }
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Pessoa",
    entidadeId: destinoId,
    descricao: `${vendedores.length} cadastro(s) vinculados à mesma pessoa: ${vendedores
      .map((vendedor) => vendedor.cpfCnpj)
      .join(", ")}`,
    dadosDepois: {
      pessoaDestino: destinoId,
      pessoasOrigem: origens,
      documentos: vendedores.map((vendedor) => ({
        id: vendedor.id,
        nome: vendedor.nome,
        cpfCnpj: vendedor.cpfCnpj,
      })),
      motivo,
    },
    usuario,
  });

  return { pessoaId: destinoId, documentosVinculados: vendedores.length };
}

/**
 * Retira um documento da pessoa e o coloca numa pessoa nova.
 *
 * Os períodos de categoria e recuperação permanecem com a pessoa original —
 * eles são do indivíduo, não do documento, e não há como saber a qual parte
 * pertenciam. O cadastro separado começa sem categoria e precisa de um novo
 * registro para voltar a gerar comissão.
 */
export async function separarDocumento(
  entrada: { vendedorId: string; motivo: string },
  usuario: ContextoUsuario,
): Promise<{ pessoaId: string }> {
  const motivo = entrada.motivo.trim();
  if (!motivo) throw new Error("Informe o motivo da separação.");

  const vendedor = await prisma.vendedor.findUniqueOrThrow({
    where: { id: entrada.vendedorId },
    select: { id: true, nome: true, cpfCnpj: true, pessoaId: true },
  });

  const documentosDaPessoa = vendedor.pessoaId
    ? await prisma.vendedor.count({ where: { pessoaId: vendedor.pessoaId } })
    : 0;

  if (documentosDaPessoa <= 1) {
    throw new Error("Este cadastro já é o único documento da pessoa.");
  }

  const pessoaAnteriorId = vendedor.pessoaId;

  const novaPessoaId = await prisma.$transaction(async (tx) => {
    if (pessoaAnteriorId) {
      await tx.pessoaVinculoHistorico.create({
        data: {
          pessoaId: pessoaAnteriorId,
          vendedorId: vendedor.id,
          vendedorNome: vendedor.nome,
          vendedorDocumento: vendedor.cpfCnpj,
          acao: "DESVINCULO",
          motivo,
          usuarioId: usuario.id,
          usuarioNome: usuario.nome,
        },
      });
    }

    return criarPessoaParaVendedor(vendedor, tx, usuario);
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Pessoa",
    entidadeId: novaPessoaId,
    descricao: `Cadastro ${vendedor.cpfCnpj} (${vendedor.nome}) separado para uma pessoa própria`,
    dadosAntes: { pessoaId: pessoaAnteriorId },
    dadosDepois: { pessoaId: novaPessoaId, motivo },
    usuario,
  });

  return { pessoaId: novaPessoaId };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface DocumentoDaPessoa {
  vendedorId: string;
  nome: string;
  cpfCnpj: string;
  tipo: "CPF" | "CNPJ" | "OUTRO";
  situacao: string;
  cotas: number;
  credito: number;
  comissaoWr: number;
}

export interface FichaPessoa {
  id: string;
  nome: string;
  documentos: DocumentoDaPessoa[];
  totalCotas: number;
  totalCredito: number;
  totalComissaoWr: number;
}

/** Ficha consolidada da pessoa, com a quebra por documento. */
export async function carregarFichaPessoa(pessoaId: string): Promise<FichaPessoa | null> {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: pessoaId },
    select: {
      id: true,
      nome: true,
      documentos: {
        select: { id: true, nome: true, cpfCnpj: true, situacao: true },
        orderBy: { criadoEm: "asc" },
      },
    },
  });

  if (!pessoa) return null;

  const ids = pessoa.documentos.map((documento) => documento.id);

  const [porCota, porComissao] = await Promise.all([
    prisma.cota.groupBy({
      by: ["vendedorEfetivoId"],
      where: { vendedorEfetivoId: { in: ids } },
      _count: { _all: true },
      _sum: { valorCredito: true },
    }),
    prisma.comissaoWr.groupBy({
      by: ["comissaoRegistroId"],
      where: { comissaoRegistro: { vendedorId: { in: ids } } },
      _sum: { valor: true },
    }),
  ]);

  // A comissão WR pende do registro, então o vínculo com o documento vem daqui.
  const registros = await prisma.comissaoRegistro.findMany({
    where: { vendedorId: { in: ids } },
    select: { id: true, vendedorId: true },
  });
  const documentoPorRegistro = new Map(
    registros.map((registro) => [registro.id, registro.vendedorId]),
  );

  const comissaoPorDocumento = new Map<string, number>();
  for (const item of porComissao) {
    const documento = documentoPorRegistro.get(item.comissaoRegistroId);
    if (!documento) continue;
    comissaoPorDocumento.set(
      documento,
      (comissaoPorDocumento.get(documento) ?? 0) + Number(item._sum.valor ?? 0),
    );
  }

  const cotaPorDocumento = new Map(
    porCota.map((item) => [
      item.vendedorEfetivoId ?? "",
      { cotas: item._count._all, credito: Number(item._sum.valorCredito ?? 0) },
    ]),
  );

  const documentos: DocumentoDaPessoa[] = pessoa.documentos.map((documento) => {
    const cotas = cotaPorDocumento.get(documento.id);
    return {
      vendedorId: documento.id,
      nome: documento.nome,
      cpfCnpj: documento.cpfCnpj,
      tipo: tipoDocumento(documento.cpfCnpj),
      situacao: documento.situacao,
      cotas: cotas?.cotas ?? 0,
      credito: arredondar(cotas?.credito ?? 0),
      comissaoWr: arredondar(comissaoPorDocumento.get(documento.id) ?? 0),
    };
  });

  return {
    id: pessoa.id,
    nome: pessoa.nome,
    documentos,
    totalCotas: documentos.reduce((total, item) => total + item.cotas, 0),
    totalCredito: arredondar(documentos.reduce((total, item) => total + item.credito, 0)),
    totalComissaoWr: arredondar(
      documentos.reduce((total, item) => total + item.comissaoWr, 0),
    ),
  };
}

/** Todos os documentos da pessoa — usado para filtrar listagens. */
export async function documentosDaPessoa(
  pessoaId: string,
  db: Cliente = prisma,
): Promise<string[]> {
  const documentos = await db.vendedor.findMany({
    where: { pessoaId },
    select: { id: true },
  });
  return documentos.map((documento) => documento.id);
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

import "server-only";

import type { CategoriaVendedor, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatarDocumento,
  limparNomeVendedor,
  normalizarDocumento,
} from "@/lib/normalize";
import {
  encontrarRecuperacaoNaData,
  inicioDoDiaUtc,
  resolverCategoriaNaData,
  type PeriodoCategoria,
  type PeriodoRecuperacao,
} from "@/server/domain/regras";
import { registrarAuditoria } from "./auditoria";
import {
  criarPessoaParaVendedor,
  sincronizarCategoriaAtual,
  vincularAPessoaExistente,
} from "./pessoas";

type Cliente = Prisma.TransactionClient | typeof prisma;

export interface ContextoUsuario {
  id: string;
  nome: string;
}

// ---------------------------------------------------------------------------
// Resolução de categoria e recuperação a partir do histórico persistido
// ---------------------------------------------------------------------------

export async function carregarHistoricoCategorias(
  pessoaId: string,
  db: Cliente = prisma,
): Promise<PeriodoCategoria[]> {
  const registros = await db.vendedorCategoriaHistorico.findMany({
    where: { pessoaId },
    select: { categoria: true, vigenteDe: true, vigenteAte: true },
    orderBy: { vigenteDe: "asc" },
  });
  return registros;
}

export async function carregarRecuperacoes(
  pessoaId: string,
  db: Cliente = prisma,
): Promise<PeriodoRecuperacao[]> {
  const registros = await db.vendedorRecuperacao.findMany({
    where: { pessoaId },
    select: { id: true, dataInicio: true, dataFim: true },
    orderBy: { dataInicio: "asc" },
  });
  return registros;
}

/**
 * Categoria vigente na data da venda. A categoria é da pessoa, então vale para
 * todos os documentos dela. Nunca use a categoria atual para calcular uma
 * venda passada.
 */
export async function categoriaNaData(
  pessoaId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<CategoriaVendedor | null> {
  const historico = await carregarHistoricoCategorias(pessoaId, db);
  return resolverCategoriaNaData(historico, dataVenda);
}

export async function recuperacaoNaData(
  pessoaId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<PeriodoRecuperacao | null> {
  const periodos = await carregarRecuperacoes(pessoaId, db);
  return encontrarRecuperacaoNaData(periodos, dataVenda);
}

export interface AlocacaoVendedor {
  equipeId: string | null;
  gerenciaId: string | null;
}

/**
 * Equipe e gerência do vendedor na data da venda.
 *
 * Diferente da categoria, a alocação é do documento e não da pessoa: o mesmo
 * vendedor pode operar por CNPJs de equipes distintas. Sem período no histórico
 * que cubra a data, vale a alocação atual do cadastro — é o melhor palpite para
 * uma base importada antes de o RH registrar as movimentações.
 */
export async function alocacaoNaData(
  vendedorId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<AlocacaoVendedor> {
  const dia = inicioDoDiaUtc(dataVenda);

  const periodo = await db.vendedorAlocacaoHistorico.findFirst({
    where: {
      vendedorId,
      vigenteDe: { lte: dia },
      OR: [{ vigenteAte: null }, { vigenteAte: { gte: dia } }],
    },
    select: { equipeId: true, gerenciaId: true },
    orderBy: { vigenteDe: "desc" },
  });
  if (periodo) return periodo;

  const vendedor = await db.vendedor.findUnique({
    where: { id: vendedorId },
    select: { equipeId: true, gerenciaId: true },
  });
  return { equipeId: vendedor?.equipeId ?? null, gerenciaId: vendedor?.gerenciaId ?? null };
}

/** Pessoa dona do cadastro. */
export async function pessoaDoVendedor(
  vendedorId: string,
  db: Cliente = prisma,
): Promise<string | null> {
  const vendedor = await db.vendedor.findUnique({
    where: { id: vendedorId },
    select: { pessoaId: true },
  });
  return vendedor?.pessoaId ?? null;
}

// ---------------------------------------------------------------------------
// Cache em memória para importações em lote
// ---------------------------------------------------------------------------

/**
 * Durante uma importação, a mesma dupla vendedor/histórico é consultada
 * milhares de vezes. Este cache evita ida ao banco por linha do arquivo.
 */
export class CacheVendedores {
  private categorias = new Map<string, PeriodoCategoria[]>();
  private recuperacoes = new Map<string, PeriodoRecuperacao[]>();
  private alocacoes = new Map<string, AlocacaoVendedor>();
  private porDocumento = new Map<string, string | null>();
  private pessoaPorVendedor = new Map<string, string | null>();

  constructor(private readonly db: Cliente = prisma) {}

  /** Categoria e recuperação são da pessoa: o cadastro só aponta o caminho. */
  async pessoaDe(vendedorId: string): Promise<string | null> {
    if (this.pessoaPorVendedor.has(vendedorId)) {
      return this.pessoaPorVendedor.get(vendedorId) ?? null;
    }
    const vendedor = await this.db.vendedor.findUnique({
      where: { id: vendedorId },
      select: { pessoaId: true },
    });
    const pessoaId = vendedor?.pessoaId ?? null;
    this.pessoaPorVendedor.set(vendedorId, pessoaId);
    return pessoaId;
  }

  async categoriaNaData(
    vendedorId: string,
    dataVenda: Date,
  ): Promise<CategoriaVendedor | null> {
    const pessoaId = await this.pessoaDe(vendedorId);
    if (!pessoaId) return null;

    let historico = this.categorias.get(pessoaId);
    if (!historico) {
      historico = await carregarHistoricoCategorias(pessoaId, this.db);
      this.categorias.set(pessoaId, historico);
    }
    return resolverCategoriaNaData(historico, dataVenda);
  }

  /** A alocação é do documento, então a chave inclui a data consultada. */
  async alocacaoNaData(vendedorId: string, dataVenda: Date): Promise<AlocacaoVendedor> {
    const chave = `${vendedorId}|${inicioDoDiaUtc(dataVenda).toISOString().slice(0, 10)}`;
    const guardada = this.alocacoes.get(chave);
    if (guardada) return guardada;

    const alocacao = await alocacaoNaData(vendedorId, dataVenda, this.db);
    this.alocacoes.set(chave, alocacao);
    return alocacao;
  }

  async recuperacaoNaData(
    vendedorId: string,
    dataVenda: Date,
  ): Promise<PeriodoRecuperacao | null> {
    const pessoaId = await this.pessoaDe(vendedorId);
    if (!pessoaId) return null;

    let periodos = this.recuperacoes.get(pessoaId);
    if (!periodos) {
      periodos = await carregarRecuperacoes(pessoaId, this.db);
      this.recuperacoes.set(pessoaId, periodos);
    }
    return encontrarRecuperacaoNaData(periodos, dataVenda);
  }

  async idPorDocumento(documento: string): Promise<string | null> {
    const chave = normalizarDocumento(documento);
    if (!chave) return null;
    if (this.porDocumento.has(chave)) return this.porDocumento.get(chave) ?? null;

    const vendedor = await this.db.vendedor.findUnique({
      where: { cpfCnpj: chave },
      select: { id: true, pessoaId: true },
    });
    this.porDocumento.set(chave, vendedor?.id ?? null);
    if (vendedor) this.pessoaPorVendedor.set(vendedor.id, vendedor.pessoaId);
    return vendedor?.id ?? null;
  }

  registrar(documento: string, vendedorId: string, pessoaId?: string | null): void {
    this.porDocumento.set(normalizarDocumento(documento), vendedorId);
    if (pessoaId !== undefined) this.pessoaPorVendedor.set(vendedorId, pessoaId);
  }

  invalidar(pessoaId: string): void {
    this.categorias.delete(pessoaId);
    this.recuperacoes.delete(pessoaId);
  }
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export interface DadosVendedor {
  nome: string;
  cpfCnpj: string;
  equipeId?: string | null;
  gerenciaId?: string | null;
  categoriaAtual: CategoriaVendedor;
  dataEntradaWr?: Date | null;
  situacao?: "ATIVO" | "INATIVO" | "AFASTADO" | "DESLIGADO";
  observacoes?: string | null;
  /// Quando informado, o novo documento entra numa pessoa que já existe —
  /// é o caso do vendedor que abre CNPJ e já tinha cadastro no CPF.
  pessoaId?: string | null;
}

export async function criarVendedor(
  dados: DadosVendedor,
  usuario: ContextoUsuario,
): Promise<{ id: string }> {
  const documento = normalizarDocumento(dados.cpfCnpj);
  if (!documento) {
    throw new Error("CPF/CNPJ do vendedor é obrigatório.");
  }

  const existente = await prisma.vendedor.findUnique({
    where: { cpfCnpj: documento },
    select: { id: true, nome: true },
  });
  if (existente) {
    throw new Error(
      `Já existe vendedor cadastrado com este CPF/CNPJ: ${existente.nome}.`,
    );
  }

  const inicioVigencia = inicioDoDiaUtc(dados.dataEntradaWr ?? new Date());

  const vendedor = await prisma.$transaction(async (tx) => {
    const criado = await tx.vendedor.create({
      data: {
        nome: dados.nome.trim(),
        cpfCnpj: documento,
        cpfCnpjFormatado: formatarDocumento(documento),
        equipeId: dados.equipeId ?? null,
        gerenciaId: dados.gerenciaId ?? null,
        categoriaAtual: dados.categoriaAtual,
        dataEntradaWr: dados.dataEntradaWr ?? null,
        situacao: dados.situacao ?? "ATIVO",
        observacoes: dados.observacoes ?? null,
      },
    });

    // Documento novo de alguém que já existe entra na pessoa dela; senão,
    // nasce uma pessoa própria.
    const pessoaId = dados.pessoaId
      ? await vincularAPessoaExistente(tx, criado, dados.pessoaId, usuario)
      : await criarPessoaParaVendedor(criado, tx, usuario);

    // A pessoa que já tem histórico não ganha um período novo: a categoria
    // dela continua valendo para o documento recém-criado.
    const jaTemHistorico = dados.pessoaId
      ? await tx.vendedorCategoriaHistorico.count({ where: { pessoaId } })
      : 0;

    if (jaTemHistorico === 0) {
      await tx.vendedorCategoriaHistorico.create({
        data: {
          pessoaId,
          vendedorId: criado.id,
          categoria: dados.categoriaAtual,
          vigenteDe: inicioVigencia,
          motivo: "Categoria inicial no cadastro",
          usuarioId: usuario.id,
        },
      });
    }

    await tx.vendedorAlocacaoHistorico.create({
      data: {
        vendedorId: criado.id,
        equipeId: dados.equipeId ?? null,
        gerenciaId: dados.gerenciaId ?? null,
        vigenteDe: inicioVigencia,
        motivo: "Alocação inicial no cadastro",
        usuarioId: usuario.id,
      },
    });

    return criado;
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Vendedor",
    entidadeId: vendedor.id,
    descricao: `Vendedor ${vendedor.nome} cadastrado`,
    dadosDepois: vendedor,
    usuario,
  });

  return { id: vendedor.id };
}

/**
 * Altera a categoria atual encerrando o período anterior e abrindo um novo.
 * O histórico é append-only: nenhuma linha é removida ou sobrescrita.
 */
export async function alterarCategoria(
  vendedorId: string,
  novaCategoria: CategoriaVendedor,
  vigenteDe: Date,
  motivo: string | null,
  usuario: ContextoUsuario,
): Promise<void> {
  const vendedor = await prisma.vendedor.findUniqueOrThrow({
    where: { id: vendedorId },
    select: { id: true, nome: true, categoriaAtual: true, pessoaId: true },
  });

  const pessoaId =
    vendedor.pessoaId ??
    (await criarPessoaParaVendedor(
      await prisma.vendedor.findUniqueOrThrow({
        where: { id: vendedorId },
        select: { id: true, nome: true, cpfCnpj: true },
      }),
      prisma,
      usuario,
    ));

  const inicio = inicioDoDiaUtc(vigenteDe);

  await prisma.$transaction(async (tx) => {
    const periodoAberto = await tx.vendedorCategoriaHistorico.findFirst({
      where: { pessoaId, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

    // Quando a nova vigência começa no mesmo dia do período aberto, ou antes
    // dele, aquele período inteiro deixa de ter existido: é o cadastro que
    // nasce Iniciante e é ajustado em seguida, ou a correção retroativa de uma
    // categoria lançada errada. Corrige-se o período no lugar de abrir outro —
    // fechá-lo na véspera criaria um trecho que termina antes de começar.
    const substituiPeriodoAberto =
      periodoAberto !== null &&
      inicioDoDiaUtc(periodoAberto.vigenteDe).getTime() >= inicio.getTime();

    if (substituiPeriodoAberto) {
      await tx.vendedorCategoriaHistorico.update({
        where: { id: periodoAberto.id },
        data: { categoria: novaCategoria, vigenteDe: inicio, motivo, usuarioId: usuario.id },
      });
    } else {
      if (periodoAberto) {
        const fim = new Date(inicio);
        fim.setUTCDate(fim.getUTCDate() - 1);
        await tx.vendedorCategoriaHistorico.update({
          where: { id: periodoAberto.id },
          data: { vigenteAte: fim },
        });
      }

      await tx.vendedorCategoriaHistorico.create({
        data: {
          pessoaId,
          vendedorId,
          categoria: novaCategoria,
          vigenteDe: inicio,
          motivo,
          usuarioId: usuario.id,
        },
      });
    }

    await sincronizarCategoriaAtual(tx, pessoaId);
  });

  await registrarAuditoria({
    acao: "MUDANCA_CATEGORIA",
    entidade: "Pessoa",
    entidadeId: pessoaId,
    descricao: `Categoria de ${vendedor.nome} alterada de ${vendedor.categoriaAtual} para ${novaCategoria} a partir de ${inicio.toISOString().slice(0, 10)}`,
    dadosAntes: { categoria: vendedor.categoriaAtual },
    dadosDepois: { categoria: novaCategoria, vigenteDe: inicio, motivo, pessoaId },
    usuario,
  });
}

export async function alterarAlocacao(
  vendedorId: string,
  equipeId: string | null,
  gerenciaId: string | null,
  vigenteDe: Date,
  motivo: string | null,
  usuario: ContextoUsuario,
): Promise<void> {
  const vendedor = await prisma.vendedor.findUniqueOrThrow({
    where: { id: vendedorId },
    select: { id: true, nome: true, equipeId: true, gerenciaId: true },
  });

  if (vendedor.equipeId === equipeId && vendedor.gerenciaId === gerenciaId) return;

  const inicio = inicioDoDiaUtc(vigenteDe);

  await prisma.$transaction(async (tx) => {
    const periodoAberto = await tx.vendedorAlocacaoHistorico.findFirst({
      where: { vendedorId, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

    if (periodoAberto) {
      const fim = new Date(inicio);
      fim.setUTCDate(fim.getUTCDate() - 1);
      await tx.vendedorAlocacaoHistorico.update({
        where: { id: periodoAberto.id },
        data: { vigenteAte: fim },
      });
    }

    await tx.vendedorAlocacaoHistorico.create({
      data: { vendedorId, equipeId, gerenciaId, vigenteDe: inicio, motivo, usuarioId: usuario.id },
    });

    await tx.vendedor.update({
      where: { id: vendedorId },
      data: { equipeId, gerenciaId },
    });
  });

  await registrarAuditoria({
    acao: vendedor.equipeId !== equipeId ? "MUDANCA_EQUIPE" : "MUDANCA_GERENCIA",
    entidade: "Vendedor",
    entidadeId: vendedorId,
    descricao: `Alocação de ${vendedor.nome} atualizada`,
    dadosAntes: { equipeId: vendedor.equipeId, gerenciaId: vendedor.gerenciaId },
    dadosDepois: { equipeId, gerenciaId, motivo },
    usuario,
  });
}

export async function registrarRecuperacao(
  vendedorId: string,
  dataInicio: Date,
  dataFim: Date,
  motivo: string | null,
  usuario: ContextoUsuario,
): Promise<{ id: string; cotasMarcadas: number }> {
  if (inicioDoDiaUtc(dataFim) < inicioDoDiaUtc(dataInicio)) {
    throw new Error("A data final da recuperação não pode ser anterior à inicial.");
  }

  const vendedor = await prisma.vendedor.findUniqueOrThrow({
    where: { id: vendedorId },
    select: { id: true, nome: true, cpfCnpj: true, pessoaId: true },
  });

  const pessoaId =
    vendedor.pessoaId ?? (await criarPessoaParaVendedor(vendedor, prisma, usuario));

  // A recuperação é da pessoa, então alcança as vendas de todos os documentos
  // dela — o CPF e os CNPJs.
  const documentos = await prisma.vendedor.findMany({
    where: { pessoaId },
    select: { id: true },
  });

  const recuperacao = await prisma.vendedorRecuperacao.create({
    data: {
      pessoaId,
      vendedorId,
      dataInicio: inicioDoDiaUtc(dataInicio),
      dataFim: inicioDoDiaUtc(dataFim),
      motivo,
      usuarioId: usuario.id,
    },
  });

  // Vendas já importadas dentro do intervalo passam a ficar marcadas.
  // A marcação nunca é retirada depois.
  const marcadas = await prisma.cota.updateMany({
    where: {
      vendedorEfetivoId: { in: documentos.map((documento) => documento.id) },
      emRecuperacao: false,
      dataVenda: {
        gte: inicioDoDiaUtc(dataInicio),
        lte: inicioDoDiaUtc(dataFim),
      },
    },
    data: {
      emRecuperacao: true,
      recuperacaoId: recuperacao.id,
      recuperacaoFixadaEm: new Date(),
    },
  });

  await registrarAuditoria({
    acao: "RECUPERACAO",
    entidade: "Pessoa",
    entidadeId: pessoaId,
    descricao: `Recuperação de ${vendedor.nome} registrada (${dataInicio.toISOString().slice(0, 10)} a ${dataFim.toISOString().slice(0, 10)}), alcançando ${documentos.length} documento(s). ${marcadas.count} venda(s) marcada(s).`,
    dadosDepois: {
      recuperacaoId: recuperacao.id,
      pessoaId,
      documentos: documentos.length,
      dataInicio,
      dataFim,
      motivo,
    },
    usuario,
  });

  return { id: recuperacao.id, cotasMarcadas: marcadas.count };
}

/**
 * Localiza o vendedor pelo documento da base da administradora. Quando não
 * existe cadastro interno, cria um registro provisório para que a cota fique
 * vinculada — o RH ajusta equipe, gerência e categoria depois.
 */
export async function garantirVendedorPorDocumento(
  documentoBruto: string | null | undefined,
  nomeBruto: string | null | undefined,
  db: Cliente,
  cache?: CacheVendedores,
): Promise<{ id: string; criado: boolean } | null> {
  const documento = normalizarDocumento(documentoBruto);
  if (!documento) return null;

  if (cache) {
    const emCache = await cache.idPorDocumento(documento);
    if (emCache) return { id: emCache, criado: false };
  } else {
    const existente = await db.vendedor.findUnique({
      where: { cpfCnpj: documento },
      select: { id: true },
    });
    if (existente) return { id: existente.id, criado: false };
  }

  const nome = limparNomeVendedor(nomeBruto) || `Vendedor ${formatarDocumento(documento)}`;

  const criado = await db.vendedor.create({
    data: {
      nome,
      cpfCnpj: documento,
      cpfCnpjFormatado: formatarDocumento(documento),
      categoriaAtual: "INICIANTE",
      situacao: "ATIVO",
      observacoes:
        "Criado automaticamente pela importação da base da administradora. " +
        "Defina categoria, equipe e gerência para que as vendas passem a gerar comissão WR. " +
        "Se for outro documento de alguém já cadastrado, use a tela de vínculos.",
    },
    select: { id: true, nome: true, cpfCnpj: true },
  });

  // Nasce numa pessoa própria. O vínculo com os outros documentos do mesmo
  // vendedor é feito depois, com conferência, na tela de vínculos.
  const pessoaId = await criarPessoaParaVendedor(criado, db);

  cache?.registrar(documento, criado.id, pessoaId);
  return { id: criado.id, criado: true };
}

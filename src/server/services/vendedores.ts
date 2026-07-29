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

type Cliente = Prisma.TransactionClient | typeof prisma;

export interface ContextoUsuario {
  id: string;
  nome: string;
}

// ---------------------------------------------------------------------------
// Resolução de categoria e recuperação a partir do histórico persistido
// ---------------------------------------------------------------------------

export async function carregarHistoricoCategorias(
  vendedorId: string,
  db: Cliente = prisma,
): Promise<PeriodoCategoria[]> {
  const registros = await db.vendedorCategoriaHistorico.findMany({
    where: { vendedorId },
    select: { categoria: true, vigenteDe: true, vigenteAte: true },
    orderBy: { vigenteDe: "asc" },
  });
  return registros;
}

export async function carregarRecuperacoes(
  vendedorId: string,
  db: Cliente = prisma,
): Promise<PeriodoRecuperacao[]> {
  const registros = await db.vendedorRecuperacao.findMany({
    where: { vendedorId },
    select: { id: true, dataInicio: true, dataFim: true },
    orderBy: { dataInicio: "asc" },
  });
  return registros;
}

/**
 * Categoria vigente do vendedor na data da venda. Nunca use a categoria atual
 * do vendedor para calcular uma venda passada.
 */
export async function categoriaNaData(
  vendedorId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<CategoriaVendedor | null> {
  const historico = await carregarHistoricoCategorias(vendedorId, db);
  return resolverCategoriaNaData(historico, dataVenda);
}

export async function recuperacaoNaData(
  vendedorId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<PeriodoRecuperacao | null> {
  const periodos = await carregarRecuperacoes(vendedorId, db);
  return encontrarRecuperacaoNaData(periodos, dataVenda);
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
  private porDocumento = new Map<string, string | null>();

  constructor(private readonly db: Cliente = prisma) {}

  async categoriaNaData(
    vendedorId: string,
    dataVenda: Date,
  ): Promise<CategoriaVendedor | null> {
    let historico = this.categorias.get(vendedorId);
    if (!historico) {
      historico = await carregarHistoricoCategorias(vendedorId, this.db);
      this.categorias.set(vendedorId, historico);
    }
    return resolverCategoriaNaData(historico, dataVenda);
  }

  async recuperacaoNaData(
    vendedorId: string,
    dataVenda: Date,
  ): Promise<PeriodoRecuperacao | null> {
    let periodos = this.recuperacoes.get(vendedorId);
    if (!periodos) {
      periodos = await carregarRecuperacoes(vendedorId, this.db);
      this.recuperacoes.set(vendedorId, periodos);
    }
    return encontrarRecuperacaoNaData(periodos, dataVenda);
  }

  async idPorDocumento(documento: string): Promise<string | null> {
    const chave = normalizarDocumento(documento);
    if (!chave) return null;
    if (this.porDocumento.has(chave)) return this.porDocumento.get(chave) ?? null;

    const vendedor = await this.db.vendedor.findUnique({
      where: { cpfCnpj: chave },
      select: { id: true },
    });
    this.porDocumento.set(chave, vendedor?.id ?? null);
    return vendedor?.id ?? null;
  }

  registrar(documento: string, vendedorId: string): void {
    this.porDocumento.set(normalizarDocumento(documento), vendedorId);
  }

  invalidar(vendedorId: string): void {
    this.categorias.delete(vendedorId);
    this.recuperacoes.delete(vendedorId);
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

    await tx.vendedorCategoriaHistorico.create({
      data: {
        vendedorId: criado.id,
        categoria: dados.categoriaAtual,
        vigenteDe: inicioVigencia,
        motivo: "Categoria inicial no cadastro",
        usuarioId: usuario.id,
      },
    });

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
    select: { id: true, nome: true, categoriaAtual: true },
  });

  const inicio = inicioDoDiaUtc(vigenteDe);

  await prisma.$transaction(async (tx) => {
    const periodoAberto = await tx.vendedorCategoriaHistorico.findFirst({
      where: { vendedorId, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

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
        vendedorId,
        categoria: novaCategoria,
        vigenteDe: inicio,
        motivo,
        usuarioId: usuario.id,
      },
    });

    // A categoria atual do vendedor é apenas o "espelho" do último período.
    const maisRecente = await tx.vendedorCategoriaHistorico.findFirst({
      where: { vendedorId },
      orderBy: { vigenteDe: "desc" },
    });

    await tx.vendedor.update({
      where: { id: vendedorId },
      data: { categoriaAtual: maisRecente?.categoria ?? novaCategoria },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_CATEGORIA",
    entidade: "Vendedor",
    entidadeId: vendedorId,
    descricao: `Categoria de ${vendedor.nome} alterada de ${vendedor.categoriaAtual} para ${novaCategoria} a partir de ${inicio.toISOString().slice(0, 10)}`,
    dadosAntes: { categoria: vendedor.categoriaAtual },
    dadosDepois: { categoria: novaCategoria, vigenteDe: inicio, motivo },
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
    select: { nome: true },
  });

  const recuperacao = await prisma.vendedorRecuperacao.create({
    data: {
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
      vendedorEfetivoId: vendedorId,
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
    entidade: "Vendedor",
    entidadeId: vendedorId,
    descricao: `Recuperação de ${vendedor.nome} registrada (${dataInicio.toISOString().slice(0, 10)} a ${dataFim.toISOString().slice(0, 10)}). ${marcadas.count} venda(s) marcada(s).`,
    dadosDepois: { recuperacaoId: recuperacao.id, dataInicio, dataFim, motivo },
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
        "Defina categoria, equipe e gerência para que as vendas passem a gerar comissão WR.",
    },
    select: { id: true },
  });

  cache?.registrar(documento, criado.id);
  return { id: criado.id, criado: true };
}

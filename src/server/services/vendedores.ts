import "server-only";

import type { CategoriaVendedor, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatarDocumento,
  limparNomeVendedor,
  normalizarDocumento,
} from "@/lib/normalize";
import {
  CATEGORIAS_ALCANCADAS_PELA_RECUPERACAO,
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
 * Categoria vigente na data da venda.
 *
 * A categoria é do DOCUMENTO: o CPF pode ser iniciante enquanto o CNPJ da mesma
 * pessoa já é veterano — é assim que a promoção funciona. Nunca use a categoria
 * atual para calcular uma venda passada.
 */
export async function categoriaNaData(
  vendedorId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<CategoriaVendedor | null> {
  const historico = await carregarHistoricoCategorias(vendedorId, db);
  return resolverCategoriaNaData(historico, dataVenda);
}

/** Como a categoria, a recuperação é do documento. */
export async function recuperacaoNaData(
  vendedorId: string,
  dataVenda: Date,
  db: Cliente = prisma,
): Promise<PeriodoRecuperacao | null> {
  const periodos = await carregarRecuperacoes(vendedorId, db);
  return encontrarRecuperacaoNaData(periodos, dataVenda);
}

export interface AlocacaoVendedor {
  equipeId: string | null;
  gerenciaId: string | null;
}

/** Um trecho do histórico de alocação, como o cache o guarda. */
export interface PeriodoAlocacao extends AlocacaoVendedor {
  vigenteDe: Date;
  vigenteAte: Date | null;
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
  // Chaveados por DOCUMENTO (vendedorId), não por pessoa.
  private categorias = new Map<string, PeriodoCategoria[]>();
  private recuperacoes = new Map<string, PeriodoRecuperacao[]>();
  private alocacoes = new Map<string, AlocacaoVendedor>();
  private periodosAlocacao = new Map<string, PeriodoAlocacao[]>();
  private alocacaoAtual = new Map<string, AlocacaoVendedor>();
  private porDocumento = new Map<string, string | null>();
  private pessoaPorVendedor = new Map<string, string | null>();

  constructor(private readonly db: Cliente = prisma) {}

  /** A pessoa ainda importa para o consolidado e para os vínculos. */
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
    let historico = this.categorias.get(vendedorId);
    if (!historico) {
      historico = await carregarHistoricoCategorias(vendedorId, this.db);
      this.categorias.set(vendedorId, historico);
    }
    return resolverCategoriaNaData(historico, dataVenda);
  }

  /** A alocação é do documento, então a chave inclui a data consultada. */
  async alocacaoNaData(vendedorId: string, dataVenda: Date): Promise<AlocacaoVendedor> {
    const chave = `${vendedorId}|${inicioDoDiaUtc(dataVenda).toISOString().slice(0, 10)}`;
    const guardada = this.alocacoes.get(chave);
    if (guardada) return guardada;

    const alocacao = this.periodosAlocacao.has(vendedorId)
      ? await this.resolverAlocacao(vendedorId, dataVenda)
      : await alocacaoNaData(vendedorId, dataVenda, this.db);
    this.alocacoes.set(chave, alocacao);
    return alocacao;
  }

  /** Mesma regra de `alocacaoNaData`, resolvida sobre os períodos já em memória. */
  private async resolverAlocacao(
    vendedorId: string,
    dataVenda: Date,
  ): Promise<AlocacaoVendedor> {
    const dia = inicioDoDiaUtc(dataVenda);
    const periodo = (this.periodosAlocacao.get(vendedorId) ?? []).find(
      (item) =>
        inicioDoDiaUtc(item.vigenteDe) <= dia &&
        (item.vigenteAte === null || inicioDoDiaUtc(item.vigenteAte) >= dia),
    );
    if (periodo) return { equipeId: periodo.equipeId, gerenciaId: periodo.gerenciaId };

    // Sem período que cubra a data, vale a alocação atual do cadastro — a
    // mesma saída de `alocacaoNaData`, e cacheada por vendedor porque a
    // resposta não depende da data.
    const atual = this.alocacaoAtual.get(vendedorId);
    if (atual) return atual;

    const vendedor = await this.db.vendedor.findUnique({
      where: { id: vendedorId },
      select: { equipeId: true, gerenciaId: true },
    });
    const resolvida = {
      equipeId: vendedor?.equipeId ?? null,
      gerenciaId: vendedor?.gerenciaId ?? null,
    };
    this.alocacaoAtual.set(vendedorId, resolvida);
    return resolvida;
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

  /**
   * Resolve muitos documentos numa consulta só.
   *
   * Sem isso, o primeiro lote da importação faz uma ida ao banco por linha até
   * o cache encher — e num arquivo com milhares de linhas é justamente esse
   * aquecimento que domina o tempo. Documento ausente do banco fica registrado
   * como ausente: o negativo também é resposta, e repetir a pergunta não muda
   * o resultado.
   */
  async carregarDocumentos(documentos: readonly string[]): Promise<void> {
    const faltantes = [
      ...new Set(
        documentos
          .map((documento) => normalizarDocumento(documento))
          .filter((chave) => chave && !this.porDocumento.has(chave)),
      ),
    ];
    if (faltantes.length === 0) return;

    const encontrados = await this.db.vendedor.findMany({
      where: { cpfCnpj: { in: faltantes } },
      select: { id: true, cpfCnpj: true, pessoaId: true },
    });

    for (const vendedor of encontrados) {
      this.porDocumento.set(vendedor.cpfCnpj, vendedor.id);
      this.pessoaPorVendedor.set(vendedor.id, vendedor.pessoaId);
    }
    for (const chave of faltantes) {
      if (!this.porDocumento.has(chave)) this.porDocumento.set(chave, null);
    }
  }

  /**
   * Pré-carrega os históricos de categoria, recuperação e alocação de vários
   * documentos de uma vez — três consultas no lugar de três por vendedor.
   */
  async carregarHistoricos(vendedorIds: readonly string[]): Promise<void> {
    const faltantes = [
      ...new Set(vendedorIds.filter((id) => !this.categorias.has(id))),
    ];
    if (faltantes.length === 0) return;

    const [categorias, recuperacoes, alocacoes] = await Promise.all([
      this.db.vendedorCategoriaHistorico.findMany({
        where: { vendedorId: { in: faltantes } },
        select: { vendedorId: true, categoria: true, vigenteDe: true, vigenteAte: true },
        orderBy: { vigenteDe: "asc" },
      }),
      this.db.vendedorRecuperacao.findMany({
        where: { vendedorId: { in: faltantes } },
        select: { id: true, vendedorId: true, dataInicio: true, dataFim: true },
        orderBy: { dataInicio: "asc" },
      }),
      this.db.vendedorAlocacaoHistorico.findMany({
        where: { vendedorId: { in: faltantes } },
        select: {
          vendedorId: true,
          equipeId: true,
          gerenciaId: true,
          vigenteDe: true,
          vigenteAte: true,
        },
        orderBy: { vigenteDe: "desc" },
      }),
    ]);

    // Inicializa TODOS os pedidos, inclusive os sem nenhuma linha: cadastro sem
    // histórico é uma resposta legítima, e sem a entrada vazia o cache
    // perguntaria de novo a cada venda desse vendedor.
    for (const id of faltantes) {
      this.categorias.set(id, []);
      this.recuperacoes.set(id, []);
      this.periodosAlocacao.set(id, []);
    }
    for (const linha of categorias) {
      if (linha.vendedorId) this.categorias.get(linha.vendedorId)?.push(linha);
    }
    for (const linha of recuperacoes) {
      if (linha.vendedorId) this.recuperacoes.get(linha.vendedorId)?.push(linha);
    }
    for (const linha of alocacoes) this.periodosAlocacao.get(linha.vendedorId)?.push(linha);
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

  /**
   * Registra um cadastro recém-criado pela própria importação.
   *
   * Ele nasce sem histórico nenhum, e é isso que os mapas vazios afirmam. Sem
   * a afirmação explícita o cache trataria a ausência como "ainda não
   * perguntei" e iria ao banco de novo a cada venda desse vendedor — que num
   * arquivo com base nova é a maioria das linhas.
   */
  registrar(documento: string, vendedorId: string, pessoaId?: string | null): void {
    this.porDocumento.set(normalizarDocumento(documento), vendedorId);
    if (pessoaId !== undefined) this.pessoaPorVendedor.set(vendedorId, pessoaId);
    this.categorias.set(vendedorId, []);
    this.recuperacoes.set(vendedorId, []);
    this.periodosAlocacao.set(vendedorId, []);
    this.alocacaoAtual.set(vendedorId, { equipeId: null, gerenciaId: null });
  }

  /** Invalida o cache do DOCUMENTO, que é o dono dos períodos. */
  invalidar(vendedorId: string): void {
    this.categorias.delete(vendedorId);
    this.recuperacoes.delete(vendedorId);
    this.periodosAlocacao.delete(vendedorId);
    this.alocacaoAtual.delete(vendedorId);
    for (const chave of this.alocacoes.keys()) {
      if (chave.startsWith(`${vendedorId}|`)) this.alocacoes.delete(chave);
    }
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
        tipoDocumento: documento.length === 14 ? "CNPJ" : "CPF",
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

    // Documento novo abre o PRÓPRIO período, sempre — inclusive quando a
    // pessoa já tem histórico em outro documento. Antes ele herdava o histórico
    // da pessoa; agora que a categoria é do documento, herdar deixaria o CNPJ
    // recém-aberto sem período nenhum, `categoriaNaData` devolveria nulo, e as
    // vendas dele não gerariam comissão. É precisamente o caso do vendedor
    // promovido, que é quando o documento novo mais importa.
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
      where: { vendedorId, vigenteAte: null },
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

    await sincronizarCategoriaAtual(tx, vendedorId);
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

  // A recuperação é do DOCUMENTO: alcança apenas as vendas feitas por ele.
  // Um vendedor em recuperação no CNPJ veterano não arrasta consigo as vendas
  // antigas do CPF, que foram feitas sob outra condição.
  const documentos = [{ id: vendedorId }];

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
  //
  // Só as de veterano e expert: a recuperação devolve comissão recebida da
  // administradora, e a venda de iniciante é paga pela WR — não há o que
  // cobrar de volta. Venda sem categoria congelada fica de fora pelo mesmo
  // motivo que em toda parte: marcar sem saber é supor, e a suposição aqui
  // custa dinheiro de alguém. O reapuramento marca depois, se a categoria for
  // preenchida.
  const marcadas = await prisma.cota.updateMany({
    where: {
      vendedorEfetivoId: { in: documentos.map((documento) => documento.id) },
      emRecuperacao: false,
      categoriaVenda: { in: [...CATEGORIAS_ALCANCADAS_PELA_RECUPERACAO] },
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
    descricao: `Recuperação de ${vendedor.nome} registrada no documento ${vendedor.cpfCnpj} (${dataInicio.toISOString().slice(0, 10)} a ${dataFim.toISOString().slice(0, 10)}). ${marcadas.count} venda(s) marcada(s).`,
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
      tipoDocumento: documento.length === 14 ? "CNPJ" : "CPF",
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

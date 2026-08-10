import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type CategoriaVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  chaveDuplicidade,
  normalizarSegmento,
  chaveIdentidadeCota,
  hashConteudo,
  montarIdentidadeCota,
  resolverVendedorEfetivo,
} from "@/server/domain/regras";
import { evento, type NovoEvento } from "@/shared/events/catalogo";
import { linhasDoOutbox } from "@/shared/events/outbox-prisma";
import { novoId } from "@/shared/domain/identificador";
import { drenarEventos } from "@/shared/events/handlers";
import { contarVendasForaDoDocumento } from "@/modules/comercial/infrastructure/queries/vendas-fora-do-documento";
import {
  CacheVendedores,
  garantirVendedorPorDocumento,
  type ContextoUsuario,
} from "@/server/services/vendedores";
import { registrarAuditoria } from "@/server/services/auditoria";
import { apurarComissoesEquipe } from "@/server/services/comissao-equipe";
import { lerCsvBase, type LinhaBase } from "./csv-base";

const TAMANHO_LOTE = 200;

export interface ResumoImportacaoBase {
  importacaoId: string;
  totalLinhas: number;
  criados: number;
  atualizados: number;
  inalterados: number;
  duplicados: number;
  cancelados: number;
  contemplados: number;
  erros: number;
  estornosGerados: number;
  vendedoresCriados: number;
  colunasDesconhecidas: string[];
}

interface EntradaImportacao {
  arquivo: Buffer;
  nomeArquivo: string;
  administradoraId: string;
  usuario: ContextoUsuario;
}

/**
 * Importa a base de produção da administradora.
 *
 * Princípios:
 * - Nenhum registro é apagado. Cotas ausentes do arquivo permanecem intactas.
 * - Snapshots da venda (categoria, recuperação, equipe e gerência) são gravados
 *   uma única vez, na criação, e nunca recalculados em importações seguintes.
 * - Cada alteração vinda da administradora gera uma versão no histórico.
 */
export async function importarBaseCsv(
  entrada: EntradaImportacao,
): Promise<ResumoImportacaoBase> {
  const hashArquivo = createHash("sha256").update(entrada.arquivo).digest("hex");

  const importacao = await prisma.importacao.create({
    data: {
      tipo: "BASE_CSV",
      nomeArquivo: entrada.nomeArquivo,
      tamanhoBytes: entrada.arquivo.byteLength,
      hashArquivo,
      administradoraId: entrada.administradoraId,
      usuarioId: entrada.usuario.id,
      usuarioNome: entrada.usuario.nome,
      status: "PROCESSANDO",
    },
  });

  // Cotas que esta importação criou ou alterou. É o escopo do reapuramento:
  // sem ele, cada importação reapura a base inteira, e o custo passa a crescer
  // com o tamanho do histórico em vez de com o tamanho do arquivo.
  const cotasTocadas = new Set<string>();

  const contadores = {
    criados: 0,
    atualizados: 0,
    inalterados: 0,
    duplicados: 0,
    cancelados: 0,
    contemplados: 0,
    erros: 0,
    estornosGerados: 0,
    vendedoresCriados: 0,
  };

  let totalLinhas = 0;
  let colunasDesconhecidas: string[] = [];

  try {
    const leitura = lerCsvBase(entrada.arquivo);
    totalLinhas = leitura.totalLinhas;
    colunasDesconhecidas = leitura.colunasDesconhecidas;
    contadores.erros = leitura.erros.length;

    if (leitura.erros.length > 0) {
      await prisma.importacaoErro.createMany({
        data: leitura.erros.map((erro) => ({
          importacaoId: importacao.id,
          linha: erro.numeroLinha,
          mensagem: erro.mensagem,
          conteudo: erro.conteudo,
        })),
      });
    }

    // Duplicidade dentro do próprio arquivo: só quando os sete campos coincidem.
    const vistos = new Set<string>();
    const linhasUnicas: LinhaBase[] = [];
    for (const linha of leitura.linhas) {
      const chave = chaveDuplicidade({
        administradoraId: entrada.administradoraId,
        contrato: linha.contrato,
        grupo: linha.grupo,
        cota: linha.cota,
        cpfCnpjCliente: linha.cpfCnpjCliente,
        nomeCliente: linha.nomeCliente,
        cpfCnpjVendedor: linha.cpfCnpjVendedor,
      });
      if (vistos.has(chave)) {
        contadores.duplicados += 1;
        continue;
      }
      vistos.add(chave);
      linhasUnicas.push(linha);
    }

    const cache = new CacheVendedores(prisma);

    for (let inicio = 0; inicio < linhasUnicas.length; inicio += TAMANHO_LOTE) {
      const lote = linhasUnicas.slice(inicio, inicio + TAMANHO_LOTE);
      await processarLote(lote, {
        importacaoId: importacao.id,
        administradoraId: entrada.administradoraId,
        usuario: entrada.usuario,
        cache,
        contadores,
        cotasTocadas,
        erros: leitura.erros.length,
      });
    }

    const status = contadores.erros > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";

    // Vendas novas ou com crédito/flex alterados mudam a comissão da equipe.
    // Reapura SÓ o que este arquivo tocou: cota que não mudou não tem por que
    // ser recalculada, e o resultado seria idêntico ao que já está gravado.
    //
    // Roda ANTES do despacho porque o estorno é calculado sobre a comissão já
    // apurada — inverter a ordem faria o estorno usar uma base desatualizada.
    const equipe = await apurarComissoesEquipe({
      cotaIds: [...cotasTocadas],
      registrarAuditoria: false,
    });

    // Processa a fila aqui, e não em segundo plano, para que os estornos já
    // estejam calculados quando o usuário vir o resumo. O que falhar fica
    // pendente e é recolhido depois, sem travar a importação.
    const eventos = await drenarEventos();
    contadores.estornosGerados = await prisma.estorno.count({
      where: { importacaoId: importacao.id },
    });

    // Vendas que caíram num documento já promovido. Não travam a importação —
    // o fato veio da administradora e foi gravado — mas precisam aparecer no
    // resumo, senão só seriam notadas quando o pagamento saísse errado.
    const foraDoDocumento = await contarVendasForaDoDocumento();

    await prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status,
        finalizadoEm: new Date(),
        totalLinhas,
        qtdCriados: contadores.criados,
        qtdAtualizados: contadores.atualizados,
        qtdInalterados: contadores.inalterados,
        qtdDuplicados: contadores.duplicados,
        qtdCancelados: contadores.cancelados,
        qtdContemplados: contadores.contemplados,
        qtdErros: contadores.erros,
        resumo: {
          estornosGerados: contadores.estornosGerados,
          vendedoresCriados: contadores.vendedoresCriados,
          colunasDesconhecidas,
          comissaoEquipe: {
            linhas: equipe.linhasGravadas,
            previsto: equipe.valorPrevisto,
            liberado: equipe.valorLiberado,
          },
          eventos: {
            processados: eventos.eventos,
            entregas: eventos.entregasOk,
            falhas: eventos.eventosComFalha,
          },
          vendasEmDocumentoFechado: foraDoDocumento,
        },
      },
    });

    await registrarAuditoria({
      acao: "IMPORTACAO",
      entidade: "Importacao",
      entidadeId: importacao.id,
      descricao: `Base importada de ${entrada.nomeArquivo}: ${contadores.criados} novos, ${contadores.atualizados} atualizados, ${contadores.duplicados} duplicados, ${contadores.erros} erros`,
      dadosDepois: contadores,
      usuario: entrada.usuario,
    });

    return {
      importacaoId: importacao.id,
      totalLinhas,
      colunasDesconhecidas,
      ...contadores,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha desconhecida na importação.";

    await prisma.importacao.update({
      where: { id: importacao.id },
      data: { status: "FALHA", finalizadoEm: new Date(), qtdErros: contadores.erros + 1 },
    });
    await prisma.importacaoErro.create({
      data: { importacaoId: importacao.id, mensagem },
    });

    throw erro;
  }
}

interface ContextoLote {
  importacaoId: string;
  administradoraId: string;
  usuario: ContextoUsuario;
  cache: CacheVendedores;
  cotasTocadas: Set<string>;
  contadores: {
    criados: number;
    atualizados: number;
    inalterados: number;
    duplicados: number;
    cancelados: number;
    contemplados: number;
    erros: number;
    estornosGerados: number;
    vendedoresCriados: number;
  };
  erros: number;
}

/** O que uma linha do arquivo vai provocar no banco, ainda sem tocar nele. */
interface PlanoCota {
  linha: LinhaBase;
  cotaId: string;
  criacao: Prisma.CotaCreateManyInput | null;
  atualizacao: Prisma.CotaUncheckedUpdateInput | null;
  inalterada: boolean;
  versao: Prisma.CotaVersaoCreateManyInput | null;
  eventos: NovoEvento[];
  efeitos: {
    criados: number;
    atualizados: number;
    inalterados: number;
    cancelados: number;
    contemplados: number;
  };
}

interface ErroLinha {
  linha: number;
  mensagem: string;
  conteudo: string;
}

/**
 * Processa um lote em duas etapas separadas de propósito: **planejar** e
 * **aplicar**.
 *
 * O desenho anterior fazia as duas coisas por linha — consultava, decidia e
 * gravava numa transação própria. Funcionava, mas o custo não estava no banco:
 * medindo uma importação real de 4.630 cotas, o Postgres executou 3,6 s de um
 * total de 53 s. O resto eram 89 mil idas e voltas e 23 mil transações. O gasto
 * era de coordenação, não de trabalho.
 *
 * Planejar primeiro permite que o lote inteiro vá numa transação só. Para isso
 * o id da cota precisa existir antes do INSERT — daí `novoId()`, sem o qual o
 * evento não teria para onde apontar e voltaríamos a inserir uma por vez.
 *
 * A garantia que motivou o outbox continua de pé, agora na granularidade do
 * lote: cota, versão e evento entram na MESMA transação. O processo caindo no
 * meio não deixa venda gravada com estorno por calcular; deixa o lote inteiro
 * de fora, e a próxima importação o recupera.
 */
async function processarLote(lote: LinhaBase[], ctx: ContextoLote): Promise<void> {
  const erros: ErroLinha[] = [];

  // --- Leituras do lote: quatro consultas, não quatro por linha ---
  const existentes = await prisma.cota.findMany({
    where: {
      administradoraId: ctx.administradoraId,
      OR: lote.map((linha) => ({
        contrato: linha.contrato,
        grupo: linha.grupo,
        cota: linha.cota,
        cpfCnpjCliente: linha.cpfCnpjCliente,
      })),
    },
    select: {
      id: true,
      administradoraId: true,
      contrato: true,
      grupo: true,
      cota: true,
      cpfCnpjCliente: true,
      hashConteudo: true,
      situacao: true,
      contemplado: true,
      emRecuperacao: true,
      vendedorEfetivoId: true,
      categoriaVenda: true,
    },
  });

  const porIdentidade = new Map(
    existentes.map((cota) => [
      chaveIdentidadeCota({
        administradoraId: cota.administradoraId,
        contrato: cota.contrato,
        grupo: cota.grupo,
        cota: cota.cota,
        cpfCnpjCliente: cota.cpfCnpjCliente,
      }),
      cota,
    ]),
  );

  // Cotas com vendedor definido manualmente pela WR. O override tem precedência
  // e a importação não pode desfazê-lo.
  const comOverride = new Set(
    (
      await prisma.cotaVendedorOverride.findMany({
        where: { cotaId: { in: existentes.map((cota) => cota.id) } },
        select: { cotaId: true },
      })
    ).map((override) => override.cotaId),
  );

  await ctx.cache.carregarDocumentos(
    lote.map((linha) => linha.cpfCnpjVendedor ?? "").filter(Boolean),
  );

  // Resolver o vendedor pode CRIAR cadastro, então acontece antes do
  // planejamento: a cota referencia o vendedor por chave estrangeira.
  const vendedorPorLinha = new Map<LinhaBase, string | null>();
  for (const linha of lote) {
    try {
      const vendedor = await garantirVendedorPorDocumento(
        linha.cpfCnpjVendedor,
        linha.nomeVendedor,
        prisma,
        ctx.cache,
      );
      if (vendedor?.criado) ctx.contadores.vendedoresCriados += 1;
      vendedorPorLinha.set(linha, vendedor?.id ?? null);
    } catch (erro) {
      erros.push(descreverErro(linha, erro));
    }
  }

  await ctx.cache.carregarHistoricos(
    [...vendedorPorLinha.values()].filter((id): id is string => id !== null),
  );

  // --- Planejamento: só memória e cache ---
  const planos: PlanoCota[] = [];
  for (const linha of lote) {
    if (!vendedorPorLinha.has(linha)) continue;
    try {
      const identidade = montarIdentidadeCota({
        administradoraId: ctx.administradoraId,
        contrato: linha.contrato,
        grupo: linha.grupo,
        cota: linha.cota,
        cpfCnpjCliente: linha.cpfCnpjCliente,
      });
      const existente = porIdentidade.get(chaveIdentidadeCota(identidade)) ?? null;
      const vendedorAdmId = vendedorPorLinha.get(linha) ?? null;

      planos.push(
        existente
          ? await planejarAtualizacao(existente, comOverride.has(existente.id), linha, vendedorAdmId, ctx)
          : await planejarCriacao(identidade, linha, vendedorAdmId, ctx),
      );
    } catch (erro) {
      erros.push(descreverErro(linha, erro));
    }
  }

  // --- Aplicação ---
  try {
    await aplicar(planos, ctx);
    for (const plano of planos) contabilizar(plano, ctx);
  } catch {
    // Uma linha ruim derruba a transação inteira e levaria junto 199 linhas
    // boas. Refaz o lote uma a uma para isolar a culpada: é lento, mas só
    // acontece no lote com defeito, e o alternativo seria perder o lote todo.
    for (const plano of planos) {
      try {
        await aplicar([plano], ctx);
        contabilizar(plano, ctx);
      } catch (erro) {
        erros.push(descreverErro(plano.linha, erro));
      }
    }
  }

  if (erros.length > 0) {
    ctx.contadores.erros += erros.length;
    await prisma.importacaoErro.createMany({
      data: erros.map((erro) => ({ importacaoId: ctx.importacaoId, ...erro })),
    });
  }
}

function descreverErro(linha: LinhaBase, erro: unknown): ErroLinha {
  return {
    linha: linha.numeroLinha,
    mensagem: erro instanceof Error ? erro.message : "Erro ao gravar a cota.",
    conteudo: `${linha.contrato} / ${linha.grupo}-${linha.cota}`,
  };
}

/**
 * Grava o que os planos descrevem, numa transação só.
 *
 * A ordem das operações não é arbitrária: a versão e o evento referenciam a
 * cota, então ela entra primeiro.
 */
async function aplicar(planos: readonly PlanoCota[], ctx: ContextoLote): Promise<void> {
  const criacoes = planos.map((plano) => plano.criacao).filter((item) => item !== null);
  const versoes = planos.map((plano) => plano.versao).filter((item) => item !== null);
  const inalteradas = planos.filter((plano) => plano.inalterada).map((plano) => plano.cotaId);
  const eventos = planos.flatMap((plano) => plano.eventos);

  const operacoes: Prisma.PrismaPromise<unknown>[] = [];

  if (criacoes.length > 0) operacoes.push(prisma.cota.createMany({ data: criacoes }));

  for (const plano of planos) {
    if (!plano.atualizacao) continue;
    operacoes.push(
      prisma.cota.update({ where: { id: plano.cotaId }, data: plano.atualizacao }),
    );
  }

  // Cota inalterada só precisa registrar que este arquivo a mencionou. Uma
  // única operação cobre todas as do lote.
  if (inalteradas.length > 0) {
    operacoes.push(
      prisma.cota.updateMany({
        where: { id: { in: inalteradas } },
        data: { ultimaImportacaoId: ctx.importacaoId },
      }),
    );
  }

  if (versoes.length > 0) operacoes.push(prisma.cotaVersao.createMany({ data: versoes }));
  if (eventos.length > 0) {
    operacoes.push(prisma.eventoDominio.createMany({ data: linhasDoOutbox(eventos) }));
  }

  if (operacoes.length === 0) return;
  await prisma.$transaction(operacoes);
}

/** Contadores e escopo de reapuramento só depois da gravação confirmada. */
function contabilizar(plano: PlanoCota, ctx: ContextoLote): void {
  ctx.contadores.criados += plano.efeitos.criados;
  ctx.contadores.atualizados += plano.efeitos.atualizados;
  ctx.contadores.inalterados += plano.efeitos.inalterados;
  ctx.contadores.cancelados += plano.efeitos.cancelados;
  ctx.contadores.contemplados += plano.efeitos.contemplados;
  if (!plano.inalterada) ctx.cotasTocadas.add(plano.cotaId);
}

/** Campos que a administradora controla e que podem mudar entre importações. */
function camposMutaveis(linha: LinhaBase) {
  return {
    nomeCliente: linha.nomeCliente,
    tipoPessoa: linha.tipoPessoa,
    contatoCliente: linha.contatoCliente,
    emailCliente: linha.emailCliente,
    ufCliente: linha.ufCliente,
    dataVenda: linha.dataVenda,
    dataEntrada: linha.dataEntrada,
    situacao: linha.situacao,
    situacaoOriginal: linha.situacaoOriginal,
    diaVencimento: linha.diaVencimento,
    valorCredito: decimalOuNulo(linha.valorCredito),
    valorParcela: decimalOuNulo(linha.valorParcela),
    meioPagamento: linha.meioPagamento,
    segmento: linha.segmento,
    produto: linha.produto,
    prazo: linha.prazo,
    parcelasPagas: linha.parcelasPagas,
    parcelasAntecipadas: linha.parcelasAntecipadas,
    parcelasEmitidas: linha.parcelasEmitidas,
    dataUltimoPagamento: linha.dataUltimoPagamento,
    contemplado: linha.contemplado,
    dataContemplacao: linha.dataContemplacao,
    valorCreditoContemplado: decimalOuNulo(linha.valorCreditoContemplado),
    alienado: linha.alienado,
    dataAlienacao: linha.dataAlienacao,
    taxaAdm: decimalOuNulo(linha.taxaAdm),
    taxaFunres: decimalOuNulo(linha.taxaFunres),
    temSeguro: linha.temSeguro,
    valorSeguro: decimalOuNulo(linha.valorSeguro),
    temFlex: linha.temFlex,
    taxaFlex: decimalOuNulo(linha.taxaFlex),
    segmentoVenda: normalizarSegmento(linha.segmento ?? linha.produto),
    cpfCnpjParceiro: linha.cpfCnpjParceiro,
    cpfCnpjVendedorAdm: linha.cpfCnpjVendedor || null,
    nomeVendedorAdm: linha.nomeVendedor,
    cpfCnpjParceiroComercial: linha.cpfCnpjParceiroComercial,
    nomeParceiroComercial: linha.nomeParceiroComercial,
    origemVenda: linha.origemVenda,
    dataCancelamento: linha.dataCancelamento,
  };
}

function decimalOuNulo(valor: number | null): Prisma.Decimal | null {
  if (valor === null || valor === undefined) return null;
  return new Prisma.Decimal(valor.toFixed(2));
}

async function planejarCriacao(
  identidade: ReturnType<typeof montarIdentidadeCota>,
  linha: LinhaBase,
  vendedorAdmId: string | null,
  ctx: ContextoLote,
): Promise<PlanoCota> {
  const dados = camposMutaveis(linha);

  // O override é consultado antes da criação: uma transferência pode ter sido
  // cadastrada para uma cota que ainda não existia na base.
  const efetivo = resolverVendedorEfetivo({
    vendedorOverrideId: null,
    vendedorAdministradoraId: vendedorAdmId,
  });

  // --- Snapshots imutáveis da venda ---
  const dataVenda = linha.dataVenda ?? linha.dataEntrada;
  let categoriaVenda = null as Awaited<ReturnType<CacheVendedores["categoriaNaData"]>>;
  let recuperacaoId: string | null = null;

  if (efetivo.vendedorId && dataVenda) {
    categoriaVenda = await ctx.cache.categoriaNaData(efetivo.vendedorId, dataVenda);
    const recuperacao = await ctx.cache.recuperacaoNaData(efetivo.vendedorId, dataVenda);
    recuperacaoId = recuperacao?.id ?? null;
  }

  // A alocação sai do histórico do documento resolvido NA DATA DA VENDA, com a
  // alocação atual do cadastro como saída quando nenhum período cobre a data.
  const alocacao = efetivo.vendedorId
    ? await ctx.cache.alocacaoNaData(efetivo.vendedorId, dataVenda ?? new Date())
    : null;

  const agora = new Date();
  const emRecuperacao = recuperacaoId !== null;

  const conteudo = hashConteudo(dados);

  // O id nasce aqui, e não no banco: o evento abaixo precisa apontar para a
  // cota antes de ela ser inserida, que é o que permite o lote inteiro entrar
  // numa transação só.
  const cotaId = novoId();

  const eventos: NovoEvento[] = [
    evento(
      "carteira.cota.criada",
      "Cota",
      cotaId,
      {
        cotaId,
        administradoraId: ctx.administradoraId,
        vendedorEfetivoId: efetivo.vendedorId,
        dataVenda: dataVenda ? emIso(dataVenda) : null,
        valorCredito: linha.valorCredito ?? null,
      },
      metadadosDe(ctx),
    ),
  ];

  if (linha.situacao === "CANCELADO" && linha.dataCancelamento) {
    eventos.push(
      eventoCancelamento(cotaId, linha, emRecuperacao, efetivo.vendedorId, categoriaVenda, ctx),
    );
  }

  return {
    linha,
    cotaId,
    criacao: {
      id: cotaId,
      ...identidade,
      ...dados,
      vendedorAdmId,
      vendedorEfetivoId: efetivo.vendedorId,
      origemVendedor: efetivo.origem,
      categoriaVenda,
      categoriaVendaFixadaEm: dataVenda ? agora : null,
      emRecuperacao,
      recuperacaoId,
      recuperacaoFixadaEm: emRecuperacao ? agora : null,
      equipeId: alocacao?.equipeId ?? null,
      gerenciaId: alocacao?.gerenciaId ?? null,
      hashConteudo: conteudo,
      primeiraImportacaoId: ctx.importacaoId,
      ultimaImportacaoId: ctx.importacaoId,
    },
    atualizacao: null,
    inalterada: false,
    versao: {
      cotaId,
      importacaoId: ctx.importacaoId,
      hashConteudo: conteudo,
      dados: serializarDados(dados),
    },
    eventos,
    efeitos: {
      criados: 1,
      atualizados: 0,
      inalterados: 0,
      cancelados: linha.situacao === "CANCELADO" ? 1 : 0,
      contemplados: linha.contemplado ? 1 : 0,
    },
  };
}

interface CotaExistente {
  id: string;
  hashConteudo: string;
  situacao: string;
  contemplado: boolean;
  emRecuperacao: boolean;
  vendedorEfetivoId: string | null;
  categoriaVenda: CategoriaVendedor | null;
}

async function planejarAtualizacao(
  existente: CotaExistente,
  temOverride: boolean,
  linha: LinhaBase,
  vendedorAdmId: string | null,
  ctx: ContextoLote,
): Promise<PlanoCota> {
  const dados = camposMutaveis(linha);
  const conteudo = hashConteudo(dados);

  const semAlteracao: PlanoCota = {
    linha,
    cotaId: existente.id,
    criacao: null,
    atualizacao: null,
    inalterada: true,
    versao: null,
    eventos: [],
    efeitos: { criados: 0, atualizados: 0, inalterados: 1, cancelados: 0, contemplados: 0 },
  };

  if (conteudo === existente.hashConteudo) return semAlteracao;

  const virouCancelada = existente.situacao !== "CANCELADO" && linha.situacao === "CANCELADO";
  const virouContemplada = !existente.contemplado && linha.contemplado;

  const eventos: NovoEvento[] = [
    evento(
      "carteira.cota.alterada",
      "Cota",
      existente.id,
      {
        cotaId: existente.id,
        administradoraId: ctx.administradoraId,
        alteracoes: {
          situacao: [existente.situacao, linha.situacao],
          parcelasPagas: [null, linha.parcelasPagas],
        },
      },
      metadadosDe(ctx),
    ),
  ];

  // Só na TRANSIÇÃO para cancelada. Republicar o cancelamento a cada
  // importação encheria a fila de eventos que o handler descartaria por já
  // existir estorno — funcionaria, mas transformaria o outbox em lixo.
  if (virouCancelada && linha.dataCancelamento) {
    eventos.push(
      eventoCancelamento(
        existente.id,
        linha,
        existente.emRecuperacao,
        existente.vendedorEfetivoId,
        existente.categoriaVenda,
        ctx,
      ),
    );
  }

  if (virouContemplada) {
    eventos.push(
      evento(
        "carteira.cota.contemplada",
        "Cota",
        existente.id,
        {
          cotaId: existente.id,
          administradoraId: ctx.administradoraId,
          dataContemplacao: linha.dataContemplacao ? emIso(linha.dataContemplacao) : null,
        },
        metadadosDe(ctx),
      ),
    );
  }

  return {
    linha,
    cotaId: existente.id,
    criacao: null,
    atualizacao: {
      ...dados,
      // O vendedor da administradora pode ser corrigido por ela; o override
      // interno da WR continua tendo precedência e não é tocado aqui.
      vendedorAdmId,
      hashConteudo: conteudo,
      ultimaImportacaoId: ctx.importacaoId,
      ...(await sincronizacaoDoVendedor(temOverride, vendedorAdmId, linha, ctx)),
    },
    inalterada: false,
    versao: {
      cotaId: existente.id,
      importacaoId: ctx.importacaoId,
      hashConteudo: conteudo,
      dados: serializarDados(dados),
    },
    eventos,
    efeitos: {
      criados: 0,
      atualizados: 1,
      inalterados: 0,
      cancelados: virouCancelada ? 1 : 0,
      contemplados: virouContemplada ? 1 : 0,
    },
  };
}

/**
 * Cota sem override precisa refletir a correção de vendedor da administradora.
 *
 * Antes isso era um `update` separado depois da transação; virou parte do mesmo
 * `update` porque duas escritas na mesma linha custam o dobro e não protegiam
 * nada — se a segunda falhasse, a cota ficava com vendedor velho e conteúdo
 * novo, que é pior do que não ter atualizado.
 */
async function sincronizacaoDoVendedor(
  temOverride: boolean,
  vendedorAdmId: string | null,
  linha: LinhaBase,
  ctx: ContextoLote,
): Promise<Prisma.CotaUncheckedUpdateInput> {
  if (temOverride) return {};

  const alocacao = vendedorAdmId
    ? await ctx.cache.alocacaoNaData(
        vendedorAdmId,
        linha.dataVenda ?? linha.dataEntrada ?? new Date(),
      )
    : null;

  return {
    vendedorEfetivoId: vendedorAdmId,
    origemVendedor: vendedorAdmId ? "ADMINISTRADORA" : "NAO_IDENTIFICADO",
    equipeId: alocacao?.equipeId ?? null,
    gerenciaId: alocacao?.gerenciaId ?? null,
  };
}

/** Data em ISO curto: é assim que o payload do evento guarda dia. */
function emIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Rastro comum a todo evento desta importação. */
function metadadosDe(ctx: ContextoLote) {
  return {
    usuarioId: ctx.usuario.id,
    usuarioNome: ctx.usuario.nome,
    importacaoId: ctx.importacaoId,
    correlacaoId: ctx.importacaoId,
  };
}

/**
 * O fato "cota cancelada".
 *
 * O evento carrega tudo que o handler precisa para decidir o estorno, e nada
 * além disso. Repare que ele NÃO decide se há estorno: quem decide é a regra
 * vigente, consultada no momento do processamento. Aqui só se afirma o que a
 * administradora informou.
 */
function eventoCancelamento(
  cotaId: string,
  linha: LinhaBase,
  emRecuperacao: boolean,
  vendedorEfetivoId: string | null,
  categoriaVenda: CategoriaVendedor | null,
  ctx: ContextoLote,
): NovoEvento {
  return evento(
    "carteira.cota.cancelada",
    "Cota",
    cotaId,
    {
      cotaId,
      administradoraId: ctx.administradoraId,
      vendedorEfetivoId,
      dataCancelamento: emIso(linha.dataCancelamento as Date),
      parcelasPagas: linha.parcelasPagas,
      emRecuperacao,
      categoriaVenda,
    },
    metadadosDe(ctx),
  );
}

function serializarDados(dados: ReturnType<typeof camposMutaveis>): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(dados, (_chave, valor) => {
      if (valor instanceof Date) return valor.toISOString();
      if (valor instanceof Prisma.Decimal) return valor.toString();
      return valor;
    }),
  ) as Prisma.InputJsonValue;
}

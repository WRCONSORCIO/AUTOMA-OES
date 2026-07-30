import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  chaveDuplicidade,
  chaveIdentidadeCota,
  deveGerarEstorno,
  hashConteudo,
  montarIdentidadeCota,
  resolverVendedorEfetivo,
} from "@/server/domain/regras";
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
        erros: leitura.erros.length,
      });
    }

    const status = contadores.erros > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";

    // Vendas novas ou com crédito/flex alterados mudam a comissão da equipe.
    const equipe = await apurarComissoesEquipe({ registrarAuditoria: false });

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

async function processarLote(lote: LinhaBase[], ctx: ContextoLote): Promise<void> {
  // Uma consulta por lote resolve todas as cotas já existentes.
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

  for (const linha of lote) {
    try {
      const identidade = montarIdentidadeCota({
        administradoraId: ctx.administradoraId,
        contrato: linha.contrato,
        grupo: linha.grupo,
        cota: linha.cota,
        cpfCnpjCliente: linha.cpfCnpjCliente,
      });
      const existente = porIdentidade.get(chaveIdentidadeCota(identidade)) ?? null;

      const vendedor = await garantirVendedorPorDocumento(
        linha.cpfCnpjVendedor,
        linha.nomeVendedor,
        prisma,
        ctx.cache,
      );
      if (vendedor?.criado) ctx.contadores.vendedoresCriados += 1;

      if (existente) {
        await atualizarCota(existente, linha, vendedor?.id ?? null, ctx);
      } else {
        await criarCota(identidade, linha, vendedor?.id ?? null, ctx);
      }
    } catch (erro) {
      ctx.contadores.erros += 1;
      await prisma.importacaoErro.create({
        data: {
          importacaoId: ctx.importacaoId,
          linha: linha.numeroLinha,
          mensagem: erro instanceof Error ? erro.message : "Erro ao gravar a cota.",
          conteudo: `${linha.contrato} / ${linha.grupo}-${linha.cota}`,
        },
      });
    }
  }
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

async function criarCota(
  identidade: ReturnType<typeof montarIdentidadeCota>,
  linha: LinhaBase,
  vendedorAdmId: string | null,
  ctx: ContextoLote,
): Promise<void> {
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

  const alocacao = efetivo.vendedorId
    ? await prisma.vendedor.findUnique({
        where: { id: efetivo.vendedorId },
        select: { equipeId: true, gerenciaId: true },
      })
    : null;

  const agora = new Date();
  const emRecuperacao = recuperacaoId !== null;

  const geraEstorno = deveGerarEstorno({
    emRecuperacao,
    parcelasPagas: linha.parcelasPagas,
    dataCancelamento: linha.dataCancelamento,
  });

  const conteudo = hashConteudo(dados);

  const cota = await prisma.cota.create({
    data: {
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
      geraEstorno,
      hashConteudo: conteudo,
      primeiraImportacaoId: ctx.importacaoId,
      ultimaImportacaoId: ctx.importacaoId,
      versoes: {
        create: {
          importacaoId: ctx.importacaoId,
          hashConteudo: conteudo,
          dados: serializarDados(dados),
        },
      },
    },
    select: { id: true },
  });

  ctx.contadores.criados += 1;
  if (linha.situacao === "CANCELADO") ctx.contadores.cancelados += 1;
  if (linha.contemplado) ctx.contadores.contemplados += 1;

  if (geraEstorno && linha.dataCancelamento) {
    await registrarEstorno(cota.id, linha, ctx);
  }
}

async function atualizarCota(
  existente: { id: string; hashConteudo: string; situacao: string; contemplado: boolean; emRecuperacao: boolean; geraEstorno: boolean },
  linha: LinhaBase,
  vendedorAdmId: string | null,
  ctx: ContextoLote,
): Promise<void> {
  const dados = camposMutaveis(linha);
  const conteudo = hashConteudo(dados);

  if (conteudo === existente.hashConteudo) {
    ctx.contadores.inalterados += 1;
    await prisma.cota.update({
      where: { id: existente.id },
      data: { ultimaImportacaoId: ctx.importacaoId },
    });
    return;
  }

  const virouCancelada = existente.situacao !== "CANCELADO" && linha.situacao === "CANCELADO";
  const virouContemplada = !existente.contemplado && linha.contemplado;

  // A marcação de recuperação é permanente: só pode ser adicionada, nunca removida.
  const geraEstorno =
    existente.geraEstorno ||
    deveGerarEstorno({
      emRecuperacao: existente.emRecuperacao,
      parcelasPagas: linha.parcelasPagas,
      dataCancelamento: linha.dataCancelamento,
    });

  await prisma.cota.update({
    where: { id: existente.id },
    data: {
      ...dados,
      // O vendedor da administradora pode ser corrigido por ela; o override
      // interno da WR continua tendo precedência e não é tocado aqui.
      vendedorAdmId,
      geraEstorno,
      hashConteudo: conteudo,
      ultimaImportacaoId: ctx.importacaoId,
      versoes: {
        create: {
          importacaoId: ctx.importacaoId,
          hashConteudo: conteudo,
          dados: serializarDados(dados),
        },
      },
    },
  });

  ctx.contadores.atualizados += 1;
  if (virouCancelada) ctx.contadores.cancelados += 1;
  if (virouContemplada) ctx.contadores.contemplados += 1;

  if (geraEstorno && !existente.geraEstorno && linha.dataCancelamento) {
    await registrarEstorno(existente.id, linha, ctx);
  }

  // Cota sem override precisa refletir a correção de vendedor da administradora.
  await sincronizarVendedorEfetivo(existente.id, vendedorAdmId);
}

async function sincronizarVendedorEfetivo(
  cotaId: string,
  vendedorAdmId: string | null,
): Promise<void> {
  const override = await prisma.cotaVendedorOverride.findUnique({
    where: { cotaId },
    select: { vendedorId: true },
  });
  if (override) return;

  const vendedor = vendedorAdmId
    ? await prisma.vendedor.findUnique({
        where: { id: vendedorAdmId },
        select: { equipeId: true, gerenciaId: true },
      })
    : null;

  await prisma.cota.update({
    where: { id: cotaId },
    data: {
      vendedorEfetivoId: vendedorAdmId,
      origemVendedor: vendedorAdmId ? "ADMINISTRADORA" : "NAO_IDENTIFICADO",
      equipeId: vendedor?.equipeId ?? null,
      gerenciaId: vendedor?.gerenciaId ?? null,
    },
  });
}

async function registrarEstorno(
  cotaId: string,
  linha: LinhaBase,
  ctx: ContextoLote,
): Promise<void> {
  if (!linha.dataCancelamento) return;

  const jaExiste = await prisma.estorno.findUnique({
    where: { cotaId },
    select: { id: true },
  });
  if (jaExiste) return;

  await prisma.estorno.create({
    data: {
      cotaId,
      motivo: `Venda realizada durante recuperação, cancelada com ${linha.parcelasPagas} parcela(s) paga(s) — antes da 6ª parcela.`,
      parcelasPagasNoCancelamento: linha.parcelasPagas,
      dataCancelamento: linha.dataCancelamento,
      valorReferencia: decimalOuNulo(linha.valorCredito),
    },
  });

  ctx.contadores.estornosGerados += 1;
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

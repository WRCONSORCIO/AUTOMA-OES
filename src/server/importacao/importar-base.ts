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
import { publicar } from "@/shared/events/outbox-prisma";
import { drenarEventos } from "@/shared/events/handlers";
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
    // Roda ANTES do despacho porque o estorno é calculado sobre a comissão já
    // apurada — inverter a ordem faria o estorno usar uma base desatualizada.
    const equipe = await apurarComissoesEquipe({ registrarAuditoria: false });

    // Processa a fila aqui, e não em segundo plano, para que os estornos já
    // estejam calculados quando o usuário vir o resumo. O que falhar fica
    // pendente e é recolhido depois, sem travar a importação.
    const eventos = await drenarEventos();
    contadores.estornosGerados = await prisma.estorno.count({
      where: { importacaoId: importacao.id },
    });

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

  const conteudo = hashConteudo(dados);

  // A cota e o evento entram na MESMA transação. Sem isso, o processo caindo
  // entre as duas escritas deixaria a venda gravada e o estorno nunca
  // calculado — sem erro, sem alerta, e sem ninguém perceber até o fechamento
  // não bater.
  await prisma.$transaction(async (tx) => {
    const cota = await tx.cota.create({
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

    const eventos: NovoEvento[] = [
      evento(
        "carteira.cota.criada",
        "Cota",
        cota.id,
        {
          cotaId: cota.id,
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
        eventoCancelamento(
          cota.id,
          linha,
          emRecuperacao,
          efetivo.vendedorId,
          categoriaVenda,
          ctx,
        ),
      );
    }

    await publicar(tx, eventos);
  });

  ctx.contadores.criados += 1;
  if (linha.situacao === "CANCELADO") ctx.contadores.cancelados += 1;
  if (linha.contemplado) ctx.contadores.contemplados += 1;
}

async function atualizarCota(
  existente: {
    id: string;
    hashConteudo: string;
    situacao: string;
    contemplado: boolean;
    emRecuperacao: boolean;
    geraEstorno: boolean;
    vendedorEfetivoId: string | null;
    categoriaVenda: CategoriaVendedor | null;
  },
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

  await prisma.$transaction(async (tx) => {
    await tx.cota.update({
      where: { id: existente.id },
      data: {
        ...dados,
        // O vendedor da administradora pode ser corrigido por ela; o override
        // interno da WR continua tendo precedência e não é tocado aqui.
        vendedorAdmId,
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

    await publicar(tx, eventos);
  });

  ctx.contadores.atualizados += 1;
  if (virouCancelada) ctx.contadores.cancelados += 1;
  if (virouContemplada) ctx.contadores.contemplados += 1;

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

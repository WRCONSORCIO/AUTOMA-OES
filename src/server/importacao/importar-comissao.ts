import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type CategoriaVendedor, type StatusComissao } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import {
  calcularComissaoWr,
  hashConteudo,
  resolverVendedorEfetivo,
  type FaixaParcela,
} from "@/server/domain/regras";
import {
  CacheVendedores,
  garantirVendedorPorDocumento,
  type ContextoUsuario,
} from "@/server/services/vendedores";
import { registrarAuditoria } from "@/server/services/auditoria";
import { apurarComissoesEquipe } from "@/server/services/comissao-equipe";
import { lerPdfComissao, type RegistroComissaoPdf } from "./pdf-comissao";

const TAMANHO_LOTE = 100;

export interface ResumoImportacaoComissao {
  importacaoId: string;
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  semCotaVinculada: number;
  semCategoria: number;
  comissaoWrCalculada: number;
  valorComissaoRelatorio: number;
  valorComissaoWr: number;
  divergenciaLeitura: number | null;
}

interface EntradaImportacao {
  arquivo: Buffer;
  nomeArquivo: string;
  administradoraId: string;
  usuario: ContextoUsuario;
}

/**
 * Importa o relatório de fechamento de comissão em PDF.
 *
 * Para cada lançamento o sistema resolve a cota correspondente, aplica a
 * precedência do vendedor WR, herda os snapshots imutáveis da venda (categoria
 * e recuperação) e calcula a comissão interna cruzando a parcela com a tabela
 * da categoria daquela venda.
 */
export async function importarComissaoPdf(
  entrada: EntradaImportacao,
): Promise<ResumoImportacaoComissao> {
  const hashArquivo = createHash("sha256").update(entrada.arquivo).digest("hex");

  const importacao = await prisma.importacao.create({
    data: {
      tipo: "COMISSAO_PDF",
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
    duplicados: 0,
    erros: 0,
    semCotaVinculada: 0,
    semCategoria: 0,
    comissaoWrCalculada: 0,
  };
  let valorComissaoRelatorio = 0;
  let valorComissaoWr = 0;

  try {
    const leitura = await lerPdfComissao(entrada.arquivo);
    contadores.erros = leitura.erros.length;

    if (leitura.erros.length > 0) {
      await prisma.importacaoErro.createMany({
        data: leitura.erros.map((erro) => ({
          importacaoId: importacao.id,
          linha: erro.pagina,
          mensagem: `Página ${erro.pagina}: ${erro.mensagem}`,
          conteudo: erro.conteudo,
        })),
      });
    }

    const tabelas = await carregarTabelasVigentes();
    const cache = new CacheVendedores(prisma);

    for (let inicio = 0; inicio < leitura.registros.length; inicio += TAMANHO_LOTE) {
      const lote = leitura.registros.slice(inicio, inicio + TAMANHO_LOTE);

      for (const registro of lote) {
        try {
          const resultado = await gravarRegistro({
            registro,
            importacaoId: importacao.id,
            administradoraId: entrada.administradoraId,
            hashArquivo,
            tabelas,
            cache,
          });

          if (resultado.duplicado) {
            contadores.duplicados += 1;
            continue;
          }

          contadores.criados += 1;
          valorComissaoRelatorio += registro.valorComissao;
          if (!resultado.cotaVinculada) contadores.semCotaVinculada += 1;
          if (!resultado.categoria) contadores.semCategoria += 1;
          if (resultado.comissaoWr !== null) {
            contadores.comissaoWrCalculada += 1;
            valorComissaoWr += resultado.comissaoWr;
          }
        } catch (erro) {
          contadores.erros += 1;
          await prisma.importacaoErro.create({
            data: {
              importacaoId: importacao.id,
              linha: registro.pagina,
              mensagem:
                erro instanceof Error ? erro.message : "Erro ao gravar o lançamento de comissão.",
              conteudo: `${registro.contrato} / ${registro.grupo}-${registro.cota} / ${registro.tipoOriginal}`,
            },
          });
        }
      }
    }

    const status = contadores.erros > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";

    // Cada parcela recebida libera a comissão da equipe: reapura na sequência.
    const equipe = await apurarComissoesEquipe({ registrarAuditoria: false });

    await prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status,
        finalizadoEm: new Date(),
        totalLinhas: leitura.registros.length,
        qtdCriados: contadores.criados,
        qtdDuplicados: contadores.duplicados,
        qtdErros: contadores.erros,
        resumo: {
          paginas: leitura.paginas,
          dataEmissao: leitura.dataEmissao?.toISOString() ?? null,
          totaisRelatorio: { ...leitura.totais },
          somaComissaoLida: leitura.somaComissaoLida,
          divergenciaLeitura: leitura.divergencia,
          semCotaVinculada: contadores.semCotaVinculada,
          semCategoria: contadores.semCategoria,
          comissaoWrCalculada: contadores.comissaoWrCalculada,
          valorComissaoWr: arredondar(valorComissaoWr),
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
      descricao: `Relatório de comissão ${entrada.nomeArquivo} importado: ${contadores.criados} lançamentos, ${contadores.duplicados} já existentes, ${contadores.erros} erros`,
      dadosDepois: contadores,
      usuario: entrada.usuario,
    });

    return {
      importacaoId: importacao.id,
      totalRegistros: leitura.registros.length,
      valorComissaoRelatorio: arredondar(valorComissaoRelatorio),
      valorComissaoWr: arredondar(valorComissaoWr),
      divergenciaLeitura: leitura.divergencia,
      ...contadores,
    };
  } catch (erro) {
    await prisma.importacao.update({
      where: { id: importacao.id },
      data: { status: "FALHA", finalizadoEm: new Date() },
    });
    await prisma.importacaoErro.create({
      data: {
        importacaoId: importacao.id,
        mensagem: erro instanceof Error ? erro.message : "Falha desconhecida na importação.",
      },
    });
    throw erro;
  }
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

type TabelasVigentes = Map<CategoriaVendedor, { id: string; faixas: FaixaParcela[] }>;

async function carregarTabelasVigentes(): Promise<TabelasVigentes> {
  const hoje = new Date();
  const tabelas = await prisma.tabelaComissao.findMany({
    where: {
      ativo: true,
      vigenteDe: { lte: hoje },
      OR: [{ vigenteAte: null }, { vigenteAte: { gte: hoje } }],
    },
    include: { faixas: { orderBy: { parcela: "asc" } } },
    orderBy: { vigenteDe: "desc" },
  });

  const mapa: TabelasVigentes = new Map();
  for (const tabela of tabelas) {
    if (mapa.has(tabela.categoria)) continue;
    mapa.set(tabela.categoria, {
      id: tabela.id,
      faixas: tabela.faixas.map((faixa) => ({
        parcela: faixa.parcela,
        percentual: Number(faixa.percentual),
      })),
    });
  }
  return mapa;
}

interface EntradaGravacao {
  registro: RegistroComissaoPdf;
  importacaoId: string;
  administradoraId: string;
  hashArquivo: string;
  tabelas: TabelasVigentes;
  cache: CacheVendedores;
}

interface ResultadoGravacao {
  duplicado: boolean;
  cotaVinculada: boolean;
  categoria: CategoriaVendedor | null;
  comissaoWr: number | null;
}

async function gravarRegistro(entrada: EntradaGravacao): Promise<ResultadoGravacao> {
  const { registro } = entrada;

  // A idempotência é por arquivo: reimportar o mesmo PDF não duplica nada.
  const hashRegistro = hashConteudo({
    arquivo: entrada.hashArquivo,
    ordem: registro.ordem,
    contrato: registro.contrato,
    grupo: registro.grupo,
    cota: registro.cota,
    tipo: registro.tipo,
    parcela: registro.parcela,
    valor: registro.valorComissao,
  });

  const jaImportado = await prisma.comissaoRegistro.findUnique({
    where: { hashRegistro },
    select: { id: true },
  });
  if (jaImportado) {
    return { duplicado: true, cotaVinculada: false, categoria: null, comissaoWr: null };
  }

  const cota = await localizarCota(entrada.administradoraId, registro);

  const override = cota
    ? await prisma.cotaVendedorOverride.findUnique({
        where: { cotaId: cota.id },
        select: { vendedorId: true },
      })
    : null;

  const vendedorRelatorio = await garantirVendedorPorDocumento(
    registro.cpfCnpjVendedor,
    registro.nomeVendedor,
    prisma,
    entrada.cache,
  );

  const efetivo = resolverVendedorEfetivo({
    vendedorOverrideId: override?.vendedorId ?? cota?.vendedorEfetivoId ?? null,
    vendedorAdministradoraId: vendedorRelatorio?.id ?? null,
  });

  // Snapshots: quando a cota existe, a venda já tem categoria e marcação de
  // recuperação gravadas — e elas nunca são recalculadas.
  let categoria: CategoriaVendedor | null = cota?.categoriaVenda ?? null;
  let emRecuperacao = cota?.emRecuperacao ?? false;

  const dataVenda = cota?.dataVenda ?? registro.dataVenda;

  if (!cota && efetivo.vendedorId && dataVenda) {
    categoria = await entrada.cache.categoriaNaData(efetivo.vendedorId, dataVenda);
    emRecuperacao = (await entrada.cache.recuperacaoNaData(efetivo.vendedorId, dataVenda)) !== null;
  }

  const alocacao =
    cota?.equipeId || cota?.gerenciaId
      ? { equipeId: cota.equipeId, gerenciaId: cota.gerenciaId }
      : efetivo.vendedorId
        ? await prisma.vendedor.findUnique({
            where: { id: efetivo.vendedorId },
            select: { equipeId: true, gerenciaId: true },
          })
        : null;

  const status: StatusComissao =
    registro.tipo === "CANCELAMENTO_DE_PLANO" || registro.valorComissao < 0
      ? "ESTORNO"
      : "NORMAL";

  const dataReferencia =
    registro.dataPagamento ?? registro.dataContabil ?? registro.dataVenda ?? new Date();

  const tabela = categoria ? entrada.tabelas.get(categoria) : undefined;

  const calculo = calcularComissaoWr({
    categoria,
    parcela: registro.parcela,
    valorCredito: registro.valorCredito,
    percentualFlex: registro.percentualFlex,
    faixas: tabela?.faixas ?? [],
    tipo: registro.tipo,
  });

  const modalidadeFlex = await localizarModalidadeFlex(registro.percentualFlex);

  await prisma.comissaoRegistro.create({
    data: {
      importacaoId: entrada.importacaoId,
      administradoraId: entrada.administradoraId,
      contrato: registro.contrato,
      grupo: registro.grupo,
      cota: registro.cota,
      nomeCliente: registro.nomeCliente,
      contatoCliente: registro.contatoCliente,
      objeto: registro.objeto,
      valorCredito: new Prisma.Decimal(registro.valorCredito.toFixed(2)),
      percentualFlex:
        registro.percentualFlex === null
          ? null
          : new Prisma.Decimal(registro.percentualFlex.toFixed(4)),
      valorComissao: new Prisma.Decimal(registro.valorComissao.toFixed(2)),
      valorDsr: registro.valorDsr === null ? null : new Prisma.Decimal(registro.valorDsr.toFixed(2)),
      valorSeguro:
        registro.valorSeguro === null ? null : new Prisma.Decimal(registro.valorSeguro.toFixed(2)),
      percentualComissao:
        registro.percentualComissao === null
          ? null
          : new Prisma.Decimal(registro.percentualComissao.toFixed(4)),
      tipo: registro.tipo,
      tipoOriginal: registro.tipoOriginal,
      parcela: registro.parcela,
      dataPagamento: registro.dataPagamento,
      dataContabil: registro.dataContabil,
      dataCheque: registro.dataCheque,
      dataVenda: registro.dataVenda,
      dataReferencia,
      classificacaoObjeto: registro.classificacaoObjeto,
      assinatura: registro.assinatura,
      cpfCnpjVendedorRelatorio: registro.cpfCnpjVendedor || null,
      nomeVendedorRelatorio: registro.nomeVendedor || null,
      cotaId: cota?.id ?? null,
      vendedorId: efetivo.vendedorId,
      origemVendedor: efetivo.origem,
      equipeId: alocacao?.equipeId ?? null,
      gerenciaId: alocacao?.gerenciaId ?? null,
      categoriaVenda: categoria,
      emRecuperacao,
      status,
      hashRegistro,
      paginaPdf: registro.pagina,
      ordemPdf: registro.ordem,
      comissaoWr: calculo.aplicavel
        ? {
            create: {
              categoriaVenda: categoria,
              parcela: registro.parcela,
              baseCalculo: new Prisma.Decimal(calculo.baseCalculo.toFixed(2)),
              percentual: new Prisma.Decimal(calculo.percentual.toFixed(4)),
              valor: new Prisma.Decimal(calculo.valor.toFixed(2)),
              regra: calculo.regra,
              tabelaComissaoId: tabela?.id ?? null,
              modalidadeFlexId: modalidadeFlex?.id ?? null,
            },
          }
        : {
            create: {
              categoriaVenda: categoria,
              parcela: registro.parcela,
              baseCalculo: new Prisma.Decimal(calculo.baseCalculo.toFixed(2)),
              percentual: new Prisma.Decimal("0"),
              valor: new Prisma.Decimal("0"),
              regra: calculo.regra,
              observacao: calculo.observacao ?? null,
              modalidadeFlexId: modalidadeFlex?.id ?? null,
            },
          },
    },
  });

  return {
    duplicado: false,
    cotaVinculada: cota !== null,
    categoria,
    comissaoWr: calculo.aplicavel ? calculo.valor : null,
  };
}

/**
 * O relatório de comissão não traz o CPF do cliente, então a cota é localizada
 * por administradora + contrato + grupo + cota. Havendo mais de uma candidata
 * (pessoas distintas na mesma cota ao longo do tempo), o nome do cliente
 * desempata; sem desempate seguro, o lançamento fica sem vínculo e é sinalizado.
 */
async function localizarCota(administradoraId: string, registro: RegistroComissaoPdf) {
  const candidatas = await prisma.cota.findMany({
    where: {
      administradoraId,
      contrato: registro.contrato,
      grupo: registro.grupo,
      cota: registro.cota,
    },
    select: {
      id: true,
      nomeCliente: true,
      categoriaVenda: true,
      emRecuperacao: true,
      equipeId: true,
      gerenciaId: true,
      dataVenda: true,
      vendedorEfetivoId: true,
    },
  });

  if (candidatas.length === 0) return null;
  if (candidatas.length === 1) return candidatas[0]!;

  const alvo = normalizarTexto(registro.nomeCliente);
  const porNome = candidatas.filter((c) => normalizarTexto(c.nomeCliente) === alvo);
  return porNome.length === 1 ? porNome[0]! : null;
}

const cacheModalidades = new Map<string, { id: string } | null>();

async function localizarModalidadeFlex(percentual: number | null): Promise<{ id: string } | null> {
  if (percentual === null) return null;
  const chave = percentual.toFixed(4);
  if (cacheModalidades.has(chave)) return cacheModalidades.get(chave) ?? null;

  const modalidade = await prisma.modalidadeFlex.findFirst({
    where: { ativo: true, percentual: new Prisma.Decimal(chave) },
    select: { id: true },
  });
  cacheModalidades.set(chave, modalidade);
  return modalidade;
}

import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type CategoriaVendedor, type StatusComissao } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import {
  calcularComissaoWr,
  hashConteudo,
  normalizarSegmento,
  resolverVendedorEfetivo,
} from "@/server/domain/regras";
import {
  CacheVendedores,
  garantirVendedorPorDocumento,
  type ContextoUsuario,
} from "@/server/services/vendedores";
import { registrarAuditoria } from "@/server/services/auditoria";
import { apurarComissoesEquipe } from "@/server/services/comissao-equipe";
import { conferirFormulario, FORMULARIOS } from "./formularios";
import { lerPdfComissao, type RegistroComissaoPdf } from "./pdf-comissao";
import {
  evento,
  type MetadadosEvento,
  type NovoEvento,
} from "@/shared/events/catalogo";
import { publicar } from "@/shared/events/outbox-prisma";
import { drenarEventos } from "@/shared/events/handlers";

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

  // Cotas mencionadas por este relatório. É o escopo do reapuramento.
  const cotasTocadas = new Set<string>();

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

    conferirFormulario(
      leitura.formulario,
      FORMULARIOS.COMISSAO_WR,
      "comissão que a WR recebe",
    );

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
            cache,
            metadados: {
              usuarioId: entrada.usuario.id,
              usuarioNome: entrada.usuario.nome,
              importacaoId: importacao.id,
              correlacaoId: importacao.id,
            },
          });

          if (resultado.duplicado) {
            contadores.duplicados += 1;
            continue;
          }

          contadores.criados += 1;
          valorComissaoRelatorio += registro.valorComissao;
          if (resultado.cotaId) cotasTocadas.add(resultado.cotaId);
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

    // Cada parcela recebida libera a comissão da equipe: reapura na sequência,
    // mas SÓ das cotas que este relatório mencionou. As demais não tiveram
    // parcela nova e o recálculo delas devolveria exatamente o que já está
    // gravado — a um custo que cresce com o histórico, não com o arquivo.
    const equipe = await apurarComissoesEquipe({
      cotaIds: [...cotasTocadas],
      registrarAuditoria: false,
    });

    // Fecha a fila antes de o usuário ver o resumo, como na base.
    const eventos = await drenarEventos();

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
          eventos: {
            processados: eventos.eventos,
            entregas: eventos.entregasOk,
            falhas: eventos.eventosComFalha,
          },
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


interface EntradaGravacao {
  registro: RegistroComissaoPdf;
  importacaoId: string;
  administradoraId: string;
  hashArquivo: string;
  cache: CacheVendedores;
  metadados: MetadadosEvento;
}

interface ResultadoGravacao {
  duplicado: boolean;
  cotaVinculada: boolean;
  /** Cota atingida pelo lançamento, quando o cruzamento encontrou uma. */
  cotaId: string | null;
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
    return {
      duplicado: true,
      cotaVinculada: false,
      cotaId: null,
      categoria: null,
      comissaoWr: null,
    };
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

  const segmento = normalizarSegmento(registro.objeto) ?? cota?.segmentoVenda ?? null;

  // O valor é o que a administradora informou. A categoria do vendedor não
  // entra: ela decide o repasse, que é apurado separadamente.
  const calculo = calcularComissaoWr({
    valorComissao: registro.valorComissao,
    valorDsr: registro.valorDsr,
    valorSeguro: registro.valorSeguro,
    percentualRelatorio: registro.percentualComissao,
    valorCredito: registro.valorCredito,
    percentualFlex: registro.percentualFlex,
    tipo: registro.tipo,
  });

  const modalidadeFlex = await localizarModalidadeFlex(registro.percentualFlex);

  // O registro e os eventos entram na MESMA transação. Sem isso, o processo
  // caindo entre as duas escritas deixaria a parcela gravada e a liberação da
  // comissão nunca calculada — o mesmo buraco que o outbox veio fechar na base.
  await prisma.$transaction(async (tx) => {
    const gravado = await tx.comissaoRegistro.create({
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
      segmentoVenda: segmento,
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
      tabelaComissaoId: null,
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
      select: { id: true },
    });

    const eventos: NovoEvento[] = [
      evento(
        "apuracao.comissao.registrada",
        "ComissaoRegistro",
        gravado.id,
        {
          comissaoRegistroId: gravado.id,
          cotaId: cota?.id ?? null,
          vendedorId: efetivo.vendedorId,
          parcela: registro.parcela,
        },
        entrada.metadados,
      ),
    ];

    // Pagamento de parcela é o que libera a comissão prevista da equipe. Só o
    // lançamento de pagamento conta: inclusão e cancelamento de plano são
    // outros fatos, e tratá-los como parcela recebida liberaria dinheiro que
    // a administradora não pagou.
    if (cota && registro.tipo === "PAGAMENTO_COMISSAO") {
      eventos.push(
        evento(
          "carteira.cota.parcela_paga",
          "Cota",
          cota.id,
          {
            cotaId: cota.id,
            administradoraId: entrada.administradoraId,
            parcela: registro.parcela,
            comissaoRegistroId: gravado.id,
          },
          entrada.metadados,
        ),
      );
    }

    await publicar(tx, eventos);
  });

  return {
    duplicado: false,
    cotaVinculada: cota !== null,
    cotaId: cota?.id ?? null,
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
      segmentoVenda: true,
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

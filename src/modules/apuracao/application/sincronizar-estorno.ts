import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import type { ResultadoSincronizacao } from "../domain/rules/apuracao-estorno";
import { avaliarEstorno, type CategoriaVenda } from "../domain/rules/estorno";
import {
  comissaoPagaNaCota,
  lancamentosDeCancelamento,
  regrasDoVendedor,
} from "../infrastructure/repositories/regras-estorno";

/**
 * O estorno de uma cota, acertado contra os fatos de hoje.
 *
 * Este é o ÚNICO lugar que decide se existe estorno e de quanto. Antes a
 * decisão estava em três: o handler do cancelamento, a reavaliação por
 * correção de recuperação e a apuração em massa. Três cópias da mesma regra é
 * uma garantia de que uma delas fica para trás.
 *
 * O que mudou, e é a razão deste arquivo existir: **a cobrança acompanha o
 * relatório de comissão da WR, não a base de clientes.** As duas fontes falam
 * de coisas diferentes e chegam em tempos diferentes:
 *
 * - a **base de clientes** diz se o cliente está ativo. É ela que atualiza a
 *   situação da cota, e continua sendo;
 * - o **relatório de comissão** traz a linha CANCELAMENTO DE PLANO, que é o
 *   momento em que a administradora tira o dinheiro da WR.
 *
 * O cliente pode cancelar em julho e o débito só aparecer em setembro. Cobrar
 * o vendedor em julho seria cobrar antes de ter perdido — e cobrar no mês
 * errado, que para quem fecha folha dá no mesmo que cobrar duas vezes. Sem
 * lançamento no relatório não há estorno; havendo, a competência é a data do
 * lançamento.
 *
 * Repetir é seguro: o resultado sai só das regras e dos fatos, nunca do que já
 * estava gravado.
 */

export interface OpcoesSincronizacao {
  usuario?: ContextoUsuario | null;
  importacaoId?: string | null;
  /** Aparece na auditoria: quem mandou reavaliar e por quê. */
  origem?: string;
  /** Registra uma linha de auditoria por cota alterada. */
  auditarCadaCota?: boolean;
}

export async function sincronizarEstornos(
  cotaIds: readonly string[],
  opcoes: OpcoesSincronizacao = {},
): Promise<ResultadoSincronizacao[]> {
  if (cotaIds.length === 0) return [];

  const [cotas, lancamentos] = await Promise.all([
    prisma.cota.findMany({
      where: { id: { in: [...cotaIds] } },
      select: {
        id: true,
        situacao: true,
        vendedorEfetivoId: true,
        emRecuperacao: true,
        parcelasPagas: true,
        dataCancelamento: true,
        categoriaVenda: true,
        estorno: true,
      },
    }),
    lancamentosDeCancelamento(cotaIds),
  ]);

  const resultados: ResultadoSincronizacao[] = [];

  for (const cota of cotas) {
    const estornoAtual = cota.estorno;
    const valorAnterior = Number(estornoAtual?.valorEstorno ?? 0);
    const lancamento = lancamentos.get(cota.id);

    // Sem débito lançado não há cobrança — mesmo que a base já mostre a venda
    // cancelada. Se havia estorno gravado por um caminho antigo, ele sai:
    // era cobrança adiantada, e volta sozinha quando o relatório chegar.
    if (!lancamento) {
      const aguardando = cota.situacao === "CANCELADO";

      if (estornoAtual) {
        await removerEstorno(cota.id, estornoAtual, opcoes, {
          motivo: aguardando
            ? "A administradora ainda não lançou o CANCELAMENTO DE PLANO no relatório."
            : "A venda não está cancelada e não há débito lançado.",
        });

        resultados.push({
          cotaId: cota.id,
          desfecho: "REMOVIDO",
          valorEstorno: 0,
          valorAnterior,
          semComissaoPaga: false,
          motivo: "Estorno removido: não há débito da administradora sustentando a cobrança.",
        });
        continue;
      }

      resultados.push({
        cotaId: cota.id,
        desfecho: aguardando ? "AGUARDANDO_LANCAMENTO" : "SEM_CANCELAMENTO",
        valorEstorno: 0,
        valorAnterior,
        semComissaoPaga: false,
        motivo: aguardando
          ? "Cancelada na base, aguardando o lançamento da administradora."
          : "Venda ativa e sem débito de cancelamento.",
      });
      continue;
    }

    const [regras, valorReferencia] = await Promise.all([
      regrasDoVendedor(cota.vendedorEfetivoId),
      comissaoPagaNaCota(cota.id),
    ]);

    // A regra é resolvida pela data do FATO — o cancelamento do cliente. Só
    // quando a base ainda não trouxe essa data é que vale a do lançamento:
    // uma data aproximada é melhor do que deixar de cobrar um débito real.
    const dataDoFato = cota.dataCancelamento ?? lancamento.dataLancamento;

    const decisao = avaliarEstorno(
      {
        vendedorId: cota.vendedorEfetivoId,
        emRecuperacao: cota.emRecuperacao,
        parcelasPagas: cota.parcelasPagas,
        dataCancelamento: dataDoFato,
        valorReferencia,
        categoriaVenda: cota.categoriaVenda as CategoriaVenda | null,
      },
      regras,
    );

    if (!decisao.gera) {
      if (estornoAtual) {
        await removerEstorno(cota.id, estornoAtual, opcoes, { motivo: decisao.motivo });
      }

      resultados.push({
        cotaId: cota.id,
        desfecho: estornoAtual
          ? "REMOVIDO"
          : /Sem regra/i.test(decisao.motivo)
            ? "SEM_REGRA"
            : "ACIMA_DO_LIMITE",
        valorEstorno: 0,
        valorAnterior,
        semComissaoPaga: false,
        motivo: decisao.motivo,
      });
      continue;
    }

    const dados = {
      tipo: decisao.tipo,
      motivo: decisao.motivo,
      parcelasPagasNoCancelamento: cota.parcelasPagas,
      dataCancelamento: dataDoFato,
      dataCobranca: lancamento.dataLancamento,
      comissaoRegistroId: lancamento.comissaoRegistroId,
      valorReferencia,
      regraEstornoId: decisao.regraId,
      percentualAplicado: decisao.percentualAplicado,
      parcelaLimite: decisao.parcelaLimite,
      valorEstorno: decisao.valorEstorno,
    };

    if (!estornoAtual) {
      await prisma.$transaction([
        prisma.estorno.create({
          data: { cotaId: cota.id, ...dados, importacaoId: opcoes.importacaoId ?? null },
        }),
        prisma.cota.update({ where: { id: cota.id }, data: { geraEstorno: true } }),
      ]);

      if (opcoes.auditarCadaCota) {
        await registrarAuditoria({
          acao: "ESTORNO",
          entidade: "Cota",
          entidadeId: cota.id,
          descricao:
            `Estorno ${decisao.tipo} de ${decisao.valorEstorno.toFixed(2)} — ${decisao.motivo}`,
          dadosDepois: dados,
          usuario: opcoes.usuario ?? null,
        });
      }

      resultados.push({
        cotaId: cota.id,
        desfecho: "CRIADO",
        valorEstorno: decisao.valorEstorno,
        valorAnterior,
        semComissaoPaga: valorReferencia <= 0,
        motivo: decisao.motivo,
      });
      continue;
    }

    const igual =
      valorAnterior === decisao.valorEstorno &&
      estornoAtual.tipo === decisao.tipo &&
      estornoAtual.regraEstornoId === decisao.regraId &&
      estornoAtual.comissaoRegistroId === lancamento.comissaoRegistroId;

    if (igual) {
      resultados.push({
        cotaId: cota.id,
        desfecho: "INALTERADO",
        valorEstorno: decisao.valorEstorno,
        valorAnterior,
        semComissaoPaga: valorReferencia <= 0,
        motivo: decisao.motivo,
      });
      continue;
    }

    await prisma.estorno.update({ where: { cotaId: cota.id }, data: dados });

    if (opcoes.auditarCadaCota) {
      await registrarAuditoria({
        acao: "ESTORNO",
        entidade: "Cota",
        entidadeId: cota.id,
        descricao:
          `Estorno recalculado${opcoes.origem ? ` (${opcoes.origem})` : ""}: ` +
          `${valorAnterior.toFixed(2)} → ${decisao.valorEstorno.toFixed(2)} — ${decisao.motivo}`,
        dadosAntes: estornoAtual,
        dadosDepois: dados,
        usuario: opcoes.usuario ?? null,
      });
    }

    resultados.push({
      cotaId: cota.id,
      desfecho: "ATUALIZADO",
      valorEstorno: decisao.valorEstorno,
      valorAnterior,
      semComissaoPaga: valorReferencia <= 0,
      motivo: decisao.motivo,
    });
  }

  return resultados;
}

/**
 * Tira o estorno e desmarca a cota.
 *
 * A linha não é preservada anulada de propósito: `cotaId` é único, e uma linha
 * morta ocupando a chave impediria o estorno legítimo do dia em que o débito
 * finalmente aparecer no relatório. O conteúdo inteiro do que existia vai para
 * a auditoria, que é onde a reconstituição mora.
 */
async function removerEstorno(
  cotaId: string,
  estorno: unknown,
  opcoes: OpcoesSincronizacao,
  contexto: { motivo: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.estorno.delete({ where: { cotaId } }),
    prisma.cota.update({ where: { id: cotaId }, data: { geraEstorno: false } }),
  ]);

  await registrarAuditoria({
    acao: "ESTORNO",
    entidade: "Cota",
    entidadeId: cotaId,
    descricao:
      `Estorno removido${opcoes.origem ? ` (${opcoes.origem})` : ""} — ${contexto.motivo}`,
    dadosAntes: estorno as never,
    dadosDepois: null,
    usuario: opcoes.usuario ?? null,
  });
}

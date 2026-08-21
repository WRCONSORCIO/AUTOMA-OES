import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import { avaliarEstorno, type CategoriaVenda } from "../domain/rules/estorno";
import {
  comissaoPagaNaCota,
  regrasDoVendedor,
} from "../infrastructure/repositories/regras-estorno";

/**
 * Reavalia o estorno de cotas cujos fatos mudaram.
 *
 * O handler de cancelamento é deliberadamente idempotente: existindo estorno,
 * ele não mexe. Isso é certo para reentrega de evento, e errado quando o fato
 * em si foi corrigido — uma venda desmarcada de recuperação passa a merecer
 * outro julgamento, e o estorno gravado sob a premissa antiga vira cobrança
 * indevida parada no sistema.
 *
 * Daí este caminho separado. Ele não é chamado por evento: é chamado por quem
 * corrigiu o fato, e responde por escrito o que mudou.
 *
 * Três desfechos por cota:
 *
 *   - continua devendo o mesmo → nada a fazer
 *   - passa a dever outro valor ou outro tipo → o estorno é atualizado
 *   - deixa de dever → o estorno sai, e a cota deixa de contar como estornada
 *
 * O estorno removido não some do sistema: a auditoria guarda o conteúdo
 * inteiro do que existia, com autor e motivo. Manter a linha marcada como
 * anulada seria pior — `cotaId` é único, e uma linha morta ocupando a chave
 * impediria o estorno legítimo do dia em que a cota cancelasse de novo.
 */

export interface ResumoReavaliacao {
  cotasAvaliadas: number;
  estornosRemovidos: number;
  estornosAtualizados: number;
  estornosInalterados: number;
  valorLiberado: number;
}

export async function reavaliarEstornos(
  cotaIds: readonly string[],
  usuario: ContextoUsuario | null,
  origem: string,
): Promise<ResumoReavaliacao> {
  const resumo: ResumoReavaliacao = {
    cotasAvaliadas: 0,
    estornosRemovidos: 0,
    estornosAtualizados: 0,
    estornosInalterados: 0,
    valorLiberado: 0,
  };

  if (cotaIds.length === 0) return resumo;

  // Só as que têm estorno gravado. Cota sem estorno não tem o que reavaliar:
  // gerar um novo aqui seria criar cobrança fora do caminho do evento, que é
  // quem responde por isso.
  const cotas = await prisma.cota.findMany({
    where: { id: { in: [...cotaIds] }, estorno: { isNot: null } },
    select: {
      id: true,
      vendedorEfetivoId: true,
      emRecuperacao: true,
      parcelasPagas: true,
      dataCancelamento: true,
      categoriaVenda: true,
      estorno: true,
    },
  });

  for (const cota of cotas) {
    resumo.cotasAvaliadas += 1;
    const estorno = cota.estorno!;

    const [regras, valorReferencia] = await Promise.all([
      regrasDoVendedor(cota.vendedorEfetivoId),
      comissaoPagaNaCota(cota.id),
    ]);

    const decisao = avaliarEstorno(
      {
        vendedorId: cota.vendedorEfetivoId,
        emRecuperacao: cota.emRecuperacao,
        parcelasPagas: cota.parcelasPagas,
        dataCancelamento: cota.dataCancelamento,
        valorReferencia,
        categoriaVenda: cota.categoriaVenda as CategoriaVenda | null,
      },
      regras,
    );

    if (!decisao.gera) {
      await prisma.$transaction([
        prisma.estorno.delete({ where: { cotaId: cota.id } }),
        prisma.cota.update({ where: { id: cota.id }, data: { geraEstorno: false } }),
      ]);

      resumo.estornosRemovidos += 1;
      resumo.valorLiberado += Number(estorno.valorEstorno ?? 0);

      await registrarAuditoria({
        acao: "ESTORNO",
        entidade: "Cota",
        entidadeId: cota.id,
        descricao: `Estorno de ${Number(estorno.valorEstorno ?? 0).toFixed(2)} removido (${origem}) — ${decisao.motivo}`,
        // O conteúdo inteiro do que existia. É o que torna a remoção
        // reconstituível sem a linha original.
        dadosAntes: estorno,
        dadosDepois: null,
        usuario,
      });
      continue;
    }

    const mesmoValor =
      Number(estorno.valorEstorno ?? 0) === decisao.valorEstorno &&
      estorno.tipo === decisao.tipo &&
      estorno.regraEstornoId === decisao.regraId;

    if (mesmoValor) {
      resumo.estornosInalterados += 1;
      continue;
    }

    await prisma.estorno.update({
      where: { cotaId: cota.id },
      data: {
        tipo: decisao.tipo,
        motivo: decisao.motivo,
        valorReferencia,
        regraEstornoId: decisao.regraId,
        percentualAplicado: decisao.percentualAplicado,
        parcelaLimite: decisao.parcelaLimite,
        valorEstorno: decisao.valorEstorno,
      },
    });

    resumo.estornosAtualizados += 1;
    resumo.valorLiberado += Number(estorno.valorEstorno ?? 0) - decisao.valorEstorno;

    await registrarAuditoria({
      acao: "ESTORNO",
      entidade: "Cota",
      entidadeId: cota.id,
      descricao: `Estorno recalculado (${origem}): ${Number(estorno.valorEstorno ?? 0).toFixed(2)} → ${decisao.valorEstorno.toFixed(2)} — ${decisao.motivo}`,
      dadosAntes: estorno,
      dadosDepois: {
        tipo: decisao.tipo,
        regraEstornoId: decisao.regraId,
        percentualAplicado: decisao.percentualAplicado,
        valorEstorno: decisao.valorEstorno,
      },
      usuario,
    });
  }

  resumo.valorLiberado = Math.round(resumo.valorLiberado * 100) / 100;
  return resumo;
}

export interface ResumoApuracaoEstornos {
  canceladasAvaliadas: number;
  criados: number;
  atualizados: number;
  removidos: number;
  inalterados: number;
  valorTotal: number;
  /** Por que uma venda cancelada não gerou cobrança. */
  semEstorno: {
    semRegra: number;
    acimaDoLimiteDeParcelas: number;
    semComissaoPaga: number;
  };
}

/**
 * Apura o estorno de todas as vendas canceladas.
 *
 * O estorno nasce de evento, no momento em que a importação vê o
 * cancelamento. Isso é certo — mas deixa um buraco: se a regra ainda não
 * estava cadastrada naquele instante, a decisão foi "não há regra vigente", o
 * evento foi dado por processado, e nada nunca mais volta a olhar. Cadastrar a
 * regra depois não produz cobrança nenhuma, e não há erro em lugar algum
 * dizendo isso.
 *
 * É o mesmo caso da comissão, que ganhou "Apurar comissões" pela mesma razão.
 * Aqui a apuração é sobre o cancelamento: percorre as vendas canceladas,
 * aplica a regra vigente na data de cada cancelamento, e acerta o que estiver
 * diferente — criando o que falta, corrigindo o que mudou e removendo o que
 * deixou de valer.
 *
 * Repetir é seguro: o resultado depende só das regras e dos fatos, nunca do
 * que já estava gravado.
 */
export async function apurarEstornos(
  usuario: ContextoUsuario | null,
  escopo: { cotaIds?: readonly string[] } = {},
): Promise<ResumoApuracaoEstornos> {
  const resumo: ResumoApuracaoEstornos = {
    canceladasAvaliadas: 0,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    inalterados: 0,
    valorTotal: 0,
    semEstorno: { semRegra: 0, acimaDoLimiteDeParcelas: 0, semComissaoPaga: 0 },
  };

  const canceladas = await prisma.cota.findMany({
    where: {
      situacao: "CANCELADO",
      dataCancelamento: { not: null },
      ...(escopo.cotaIds ? { id: { in: [...escopo.cotaIds] } } : {}),
    },
    select: {
      id: true,
      vendedorEfetivoId: true,
      emRecuperacao: true,
      parcelasPagas: true,
      dataCancelamento: true,
      categoriaVenda: true,
      estorno: true,
    },
  });

  for (const cota of canceladas) {
    resumo.canceladasAvaliadas += 1;

    const [regras, valorReferencia] = await Promise.all([
      regrasDoVendedor(cota.vendedorEfetivoId),
      comissaoPagaNaCota(cota.id),
    ]);

    const decisao = avaliarEstorno(
      {
        vendedorId: cota.vendedorEfetivoId,
        emRecuperacao: cota.emRecuperacao,
        parcelasPagas: cota.parcelasPagas,
        dataCancelamento: cota.dataCancelamento,
        valorReferencia,
        categoriaVenda: cota.categoriaVenda as CategoriaVenda | null,
      },
      regras,
    );

    if (!decisao.gera) {
      // Os motivos somem do mesmo jeito na tela, mas pedem coisas diferentes:
      // falta de regra é cadastro, limite de parcelas é a regra funcionando.
      if (/Sem regra/i.test(decisao.motivo)) resumo.semEstorno.semRegra += 1;
      else resumo.semEstorno.acimaDoLimiteDeParcelas += 1;

      if (cota.estorno) {
        await prisma.$transaction([
          prisma.estorno.delete({ where: { cotaId: cota.id } }),
          prisma.cota.update({ where: { id: cota.id }, data: { geraEstorno: false } }),
        ]);
        resumo.removidos += 1;
      }
      continue;
    }

    // Regra manda estornar, mas não houve comissão paga: não há o que devolver.
    // Não é erro — é venda cujo pagamento ainda não saiu.
    if (valorReferencia <= 0) resumo.semEstorno.semComissaoPaga += 1;

    const dados = {
      tipo: decisao.tipo,
      motivo: decisao.motivo,
      parcelasPagasNoCancelamento: cota.parcelasPagas,
      dataCancelamento: cota.dataCancelamento!,
      valorReferencia,
      regraEstornoId: decisao.regraId,
      percentualAplicado: decisao.percentualAplicado,
      parcelaLimite: decisao.parcelaLimite,
      valorEstorno: decisao.valorEstorno,
    };

    if (!cota.estorno) {
      await prisma.$transaction([
        prisma.estorno.create({ data: { cotaId: cota.id, ...dados } }),
        prisma.cota.update({ where: { id: cota.id }, data: { geraEstorno: true } }),
      ]);
      resumo.criados += 1;
      resumo.valorTotal += decisao.valorEstorno;
      continue;
    }

    const igual =
      Number(cota.estorno.valorEstorno ?? 0) === decisao.valorEstorno &&
      cota.estorno.tipo === decisao.tipo &&
      cota.estorno.regraEstornoId === decisao.regraId;

    if (igual) {
      resumo.inalterados += 1;
      resumo.valorTotal += decisao.valorEstorno;
      continue;
    }

    await prisma.estorno.update({ where: { cotaId: cota.id }, data: dados });
    resumo.atualizados += 1;
    resumo.valorTotal += decisao.valorEstorno;
  }

  resumo.valorTotal = Math.round(resumo.valorTotal * 100) / 100;

  if (usuario) {
    await registrarAuditoria({
      acao: "ESTORNO",
      entidade: "Cota",
      descricao:
        `Apuração de estornos sobre ${resumo.canceladasAvaliadas} venda(s) cancelada(s): ` +
        `${resumo.criados} criado(s), ${resumo.atualizados} atualizado(s), ` +
        `${resumo.removidos} removido(s). Total ${resumo.valorTotal.toFixed(2)}.`,
      dadosDepois: resumo,
      usuario,
    });
  }

  return resumo;
}

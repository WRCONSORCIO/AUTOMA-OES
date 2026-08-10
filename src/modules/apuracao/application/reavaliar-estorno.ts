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

import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import {
  resumirApuracao,
  type ResumoApuracaoEstornos,
} from "../domain/rules/apuracao-estorno";
import {
  religarLancamentos,
  type ResumoReligacaoGeral,
} from "@/server/services/religar-lancamentos";
import { cotasComCancelamentoLancado } from "../infrastructure/repositories/regras-estorno";
import { sincronizarEstornos } from "./sincronizar-estorno";

export type ResumoApuracao = ResumoApuracaoEstornos & {
  /** Lançamentos que estavam soltos e voltaram a apontar para a venda. */
  religacao: ResumoReligacaoGeral;
};

export type { ResumoApuracaoEstornos };

/**
 * Os dois caminhos que mandam reavaliar estorno fora do fluxo de evento.
 *
 * A decisão em si mora em `sincronizar-estorno.ts` — aqui só se define QUAIS
 * cotas reavaliar e como o resultado é resumido para quem pediu.
 */

export interface ResumoReavaliacao {
  cotasAvaliadas: number;
  estornosRemovidos: number;
  estornosAtualizados: number;
  estornosInalterados: number;
  valorLiberado: number;
}

/**
 * Reavalia o estorno de cotas cujos fatos mudaram.
 *
 * O handler é deliberadamente idempotente: existindo estorno, ele não mexe.
 * Isso é certo para reentrega de evento, e errado quando o fato em si foi
 * corrigido — uma venda desmarcada de recuperação passa a merecer outro
 * julgamento, e o estorno gravado sob a premissa antiga vira cobrança indevida
 * parada no sistema.
 *
 * Daí este caminho separado. Ele não é chamado por evento: é chamado por quem
 * corrigiu o fato, e responde por escrito o que mudou.
 */
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

  // Só as que têm estorno gravado: aqui o gatilho é a correção de um fato, e
  // criar cobrança nova por este caminho passaria por cima da regra de que o
  // estorno nasce do lançamento da administradora.
  const comEstorno = await prisma.estorno.findMany({
    where: { cotaId: { in: [...cotaIds] } },
    select: { cotaId: true },
  });

  const resultados = await sincronizarEstornos(
    comEstorno.map((linha) => linha.cotaId),
    { usuario, origem, auditarCadaCota: true },
  );

  for (const resultado of resultados) {
    resumo.cotasAvaliadas += 1;
    if (resultado.desfecho === "REMOVIDO") resumo.estornosRemovidos += 1;
    else if (resultado.desfecho === "ATUALIZADO") resumo.estornosAtualizados += 1;
    else if (resultado.desfecho === "INALTERADO") resumo.estornosInalterados += 1;

    resumo.valorLiberado += resultado.valorAnterior - resultado.valorEstorno;
  }

  resumo.valorLiberado = Math.round(resumo.valorLiberado * 100) / 100;
  return resumo;
}

/**
 * Apura o estorno de todas as vendas com débito de cancelamento lançado.
 *
 * O estorno nasce de evento, quando a importação do relatório vê o
 * CANCELAMENTO DE PLANO. Isso é certo — mas deixa um buraco: se a regra ainda
 * não estava cadastrada naquele instante, a decisão foi "não há regra
 * vigente", o evento foi dado por processado, e nada nunca mais volta a olhar.
 * Cadastrar a regra depois não produz cobrança nenhuma, e não há erro em lugar
 * algum dizendo isso.
 *
 * É o mesmo caso da comissão, que ganhou "Apurar comissões" pela mesma razão.
 *
 * O conjunto avaliado é a união de três coisas, e cada uma responde por um
 * desfecho que só ela produz:
 *
 *   - cotas com débito lançado → é onde a cobrança pode nascer;
 *   - cotas com estorno gravado → é onde uma cobrança sem lastro é desfeita;
 *   - cotas canceladas na base → é o que sustenta o "aguardando lançamento".
 */
export async function apurarEstornos(
  usuario: ContextoUsuario | null,
  escopo: { cotaIds?: readonly string[] } = {},
): Promise<ResumoApuracao> {
  // Antes de qualquer conta: religar à venda os lançamentos que foram
  // importados antes dela existir. Vem primeiro porque tudo o que esta função
  // decide depende desses vínculos — o CANCELAMENTO DE PLANO solto faz o
  // estorno nem nascer, e a comissão solta faz a base sair zerada. Apurar
  // antes de religar gravaria valores que teriam de ser refeitos em seguida.
  const religacao = await religarLancamentos();

  const alvo = new Set<string>(escopo.cotaIds ?? []);

  if (!escopo.cotaIds) {
    const [comLancamento, comEstorno, canceladas] = await Promise.all([
      cotasComCancelamentoLancado(),
      prisma.estorno.findMany({ select: { cotaId: true } }),
      prisma.cota.findMany({ where: { situacao: "CANCELADO" }, select: { id: true } }),
    ]);

    for (const id of comLancamento) alvo.add(id);
    for (const linha of comEstorno) alvo.add(linha.cotaId);
    for (const linha of canceladas) alvo.add(linha.id);
  }

  const resultados = await sincronizarEstornos([...alvo], {
    usuario,
    origem: "apuração de estornos",
  });

  const resumo = { ...resumirApuracao(resultados), religacao };

  if (usuario) {
    await registrarAuditoria({
      acao: "ESTORNO",
      entidade: "Cota",
      descricao:
        `Apuração de estornos sobre ${resumo.canceladasAvaliadas} venda(s): ` +
        `${resumo.criados} criado(s), ${resumo.atualizados} atualizado(s), ` +
        `${resumo.removidos} removido(s), ` +
        `${resumo.semEstorno.aguardandoLancamento} aguardando lançamento da administradora, ` +
        `${religacao.religadas} linha(s) de comissão religadas à venda. ` +
        `Total ${resumo.valorTotal.toFixed(2)}.`,
      dadosDepois: resumo,
      usuario,
    });
  }

  return resumo;
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "./auditoria";
import type { ContextoUsuario } from "./vendedores";

/**
 * Religa o bônus já importado às cotas e ao organograma de hoje.
 *
 * O relatório de bônus **não traz vendedor**: só grupo, cota e contrato. A
 * gerência a que cada real pertence sai da cota — e é aí que mora o problema
 * de ordem, porque o bônus é gravado com a gerência que a cota tinha NO
 * INSTANTE DA IMPORTAÇÃO e nunca mais volta a olhar.
 *
 * Basta uma dessas três coisas acontecer depois para o número ficar errado:
 *
 *   - o relatório de bônus foi importado antes da base, e a cota ainda não
 *     existia — o bônus ficou sem cota e sem gerência;
 *   - a cota existia mas o vendedor dela ainda não tinha gerência cadastrada;
 *   - a equipe ou a gerência mudou de nome, foi unificada, ou o vendedor foi
 *     realocado.
 *
 * Nos três casos o valor continua certo e continua sendo da WR — o que se
 * perde é saber DE ONDE ele veio, que é a única pergunta que esta tela existe
 * para responder.
 *
 * A reapuração desfaz isso: procura a cota de novo e copia dela o vendedor, a
 * equipe e a gerência atuais. Não recalcula valor nenhum, porque valor de
 * bônus é fato do relatório e não se recalcula — só a atribuição muda.
 */

export interface ResumoReapuracaoBonus {
  avaliados: number;
  /** Bônus que ganharam vínculo com uma cota que antes não tinha. */
  cotasVinculadas: number;
  /** Bônus cuja gerência mudou, incluindo os que passaram a ter uma. */
  atribuicoesAtualizadas: number;
  /** Continuam sem cota na base: essas o relatório trouxe e a base não tem. */
  semCota: number;
  /** Continuam sem gerência: nem a cota nem o vendedor dela têm uma. */
  semGerencia: number;
  /** Gerência que veio do vendedor porque a cota não tinha a dela. */
  peloVendedor: number;
}

export async function reapurarBonus(
  usuario: ContextoUsuario,
): Promise<ResumoReapuracaoBonus> {
  const resumo: ResumoReapuracaoBonus = {
    avaliados: 0,
    cotasVinculadas: 0,
    atribuicoesAtualizadas: 0,
    semCota: 0,
    semGerencia: 0,
    peloVendedor: 0,
  };

  const lancamentos = await prisma.bonusIncentivo.findMany({
    select: {
      id: true,
      administradoraId: true,
      grupo: true,
      cota: true,
      contrato: true,
      cotaId: true,
      vendedorId: true,
      equipeId: true,
      gerenciaId: true,
    },
  });

  if (lancamentos.length === 0) return resumo;

  // Uma consulta para toda a base de cotas das administradoras envolvidas, em
  // vez de uma por lançamento: são centenas de linhas de bônus, e o relatório
  // inteiro cabe em memória com folga.
  const administradoras = [...new Set(lancamentos.map((linha) => linha.administradoraId))];
  const cotas = await prisma.cota.findMany({
    where: { administradoraId: { in: administradoras } },
    select: {
      id: true,
      administradoraId: true,
      grupo: true,
      cota: true,
      contrato: true,
      vendedorEfetivoId: true,
      equipeId: true,
      gerenciaId: true,
      // A alocação do VENDEDOR é o segundo caminho para a gerência, usado
      // quando o snapshot da cota ficou vazio.
      vendedorEfetivo: { select: { equipeId: true, gerenciaId: true } },
    },
  });

  type CotaLocalizada = (typeof cotas)[number];
  const porGrupoCota = new Map<string, CotaLocalizada>();
  const porContrato = new Map<string, CotaLocalizada>();

  for (const cota of cotas) {
    const chave = `${cota.administradoraId}|${cota.grupo}|${cota.cota}`;
    if (!porGrupoCota.has(chave)) porGrupoCota.set(chave, cota);

    const contrato = `${cota.administradoraId}|${cota.contrato}`;
    if (cota.contrato && !porContrato.has(contrato)) porContrato.set(contrato, cota);
  }

  for (const linha of lancamentos) {
    resumo.avaliados += 1;

    // Grupo e cota primeiro, contrato como segunda chance: grupo e cota se
    // repetem entre contratos, então o contrato é o desempate natural quando
    // a primeira busca não acha nada.
    const cota =
      porGrupoCota.get(`${linha.administradoraId}|${linha.grupo}|${linha.cota}`) ??
      porContrato.get(`${linha.administradoraId}|${linha.contrato}`) ??
      null;

    if (!cota) {
      resumo.semCota += 1;
      continue;
    }

    // A cota é a primeira fonte: ela carrega a alocação congelada na venda,
    // que é a resposta certa quando existe. Faltando, vale a alocação atual do
    // vendedor — cadastrar a gerência de alguém depois da importação é o caso
    // normal, e exigir que o snapshot da cota seja corrigido antes deixaria o
    // bônus sem dono por um detalhe interno que ninguém vê na tela.
    const doVendedor = cota.vendedorEfetivo;
    const gerenciaId = cota.gerenciaId ?? doVendedor?.gerenciaId ?? null;
    const equipeId = cota.gerenciaId ? cota.equipeId : (doVendedor?.equipeId ?? cota.equipeId);

    if (!gerenciaId) resumo.semGerencia += 1;
    else if (!cota.gerenciaId) resumo.peloVendedor += 1;

    const mudou =
      linha.cotaId !== cota.id ||
      linha.vendedorId !== cota.vendedorEfetivoId ||
      linha.equipeId !== equipeId ||
      linha.gerenciaId !== gerenciaId;

    if (!mudou) continue;

    if (linha.cotaId === null) resumo.cotasVinculadas += 1;
    resumo.atribuicoesAtualizadas += 1;

    await prisma.bonusIncentivo.update({
      where: { id: linha.id },
      data: { cotaId: cota.id, vendedorId: cota.vendedorEfetivoId, equipeId, gerenciaId },
    });
  }

  await registrarAuditoria({
    acao: "RECALCULO_COMISSAO",
    entidade: "BonusIncentivo",
    descricao:
      `Bônus reapurado sobre ${resumo.avaliados} lançamento(s): ` +
      `${resumo.cotasVinculadas} passaram a ter cota, ` +
      `${resumo.atribuicoesAtualizadas} tiveram a atribuição atualizada, ` +
      `${resumo.semCota} continuam sem cota na base.`,
    dadosDepois: resumo,
    usuario,
  });

  return resumo;
}

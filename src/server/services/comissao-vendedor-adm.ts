import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Religa à cota as linhas de comissão paga direto ao vendedor.
 *
 * O relatório CV069E identifica a venda por grupo, cota e contrato. A
 * importação procura a cota naquele instante e, não achando, grava a linha
 * solta — o valor entra no sistema, mas sem dizer a que venda pertence.
 *
 * Isso acontece o tempo todo por ordem de arquivo: o fechamento de comissão de
 * um mês costuma chegar antes da base de clientes que traz as vendas daquele
 * mês. Reimportar não resolve, porque a linha já está gravada e a importação a
 * trata como duplicada.
 *
 * O estrago é silencioso e cai justamente no estorno. A base do estorno de
 * veterano e expert é o que a administradora pagou àquela cota — e a busca é
 * `where cotaId`. Linha órfã não é encontrada, a base dá zero, e a cobrança
 * sai zerada com a regra certa e a venda certa. É o sintoma mais confuso que
 * este sistema produz, porque não há nada errado em lugar nenhum.
 *
 * Nada de valor é recalculado: o valor é fato do relatório. Só o vínculo muda.
 */

export interface ResumoReligacao {
  orfas: number;
  religadas: number;
  /** Continuam órfãs: o relatório trouxe a venda e a base ainda não tem. */
  semCota: number;
}

export async function religarComissaoVendedorAdm(): Promise<ResumoReligacao> {
  const orfas = await prisma.comissaoVendedorAdm.findMany({
    where: { cotaId: null },
    select: { id: true, administradoraId: true, grupo: true, cota: true, contrato: true },
  });

  if (orfas.length === 0) return { orfas: 0, religadas: 0, semCota: 0 };

  const administradoras = [...new Set(orfas.map((linha) => linha.administradoraId))];
  const cotas = await prisma.cota.findMany({
    where: { administradoraId: { in: administradoras } },
    select: { id: true, administradoraId: true, grupo: true, cota: true, contrato: true },
  });

  const porGrupoCota = new Map<string, string>();
  const porContrato = new Map<string, string>();

  for (const cota of cotas) {
    const chave = `${cota.administradoraId}|${cota.grupo}|${cota.cota}`;
    if (!porGrupoCota.has(chave)) porGrupoCota.set(chave, cota.id);

    const contrato = `${cota.administradoraId}|${cota.contrato}`;
    if (cota.contrato && !porContrato.has(contrato)) porContrato.set(contrato, cota.id);
  }

  // Agrupa por cota para gravar em lote: são milhares de linhas por
  // fechamento, e um update por linha faria a apuração levar minutos.
  const porDestino = new Map<string, string[]>();
  let semCota = 0;

  for (const linha of orfas) {
    const cotaId =
      porGrupoCota.get(`${linha.administradoraId}|${linha.grupo}|${linha.cota}`) ??
      porContrato.get(`${linha.administradoraId}|${linha.contrato}`) ??
      null;

    if (!cotaId) {
      semCota += 1;
      continue;
    }

    porDestino.set(cotaId, [...(porDestino.get(cotaId) ?? []), linha.id]);
  }

  let religadas = 0;
  for (const [cotaId, ids] of porDestino) {
    const { count } = await prisma.comissaoVendedorAdm.updateMany({
      where: { id: { in: ids } },
      data: { cotaId },
    });
    religadas += count;
  }

  return { orfas: orfas.length, religadas, semCota };
}

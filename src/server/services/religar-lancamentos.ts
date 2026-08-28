import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Religa à venda os lançamentos que foram importados antes dela existir.
 *
 * As três importações da administradora identificam a venda por grupo, cota e
 * contrato, procuram a cota **naquele instante** e, não achando, gravam a linha
 * solta. O valor entra no sistema sem dizer a que venda pertence, e nada volta
 * a olhar. Reimportar não resolve: a linha já está gravada e a importação a
 * trata como duplicada.
 *
 * Não é caso raro — é a ordem normal de trabalho. O fechamento de comissão de
 * um mês chega antes da base de clientes que traz as vendas daquele mês.
 *
 * O que cada vínculo perdido custa:
 *
 * - **ComissaoRegistro** é o pior. A linha de CANCELAMENTO DE PLANO é o que faz
 *   o estorno nascer, e a busca é por `cotaId`: sem vínculo, a venda fica
 *   eternamente "aguardando o débito da administradora" com o débito já lançado
 *   ali do lado. As linhas de pagamento também contam parcela recebida, que é o
 *   que libera a comissão da equipe.
 * - **ComissaoVendedorAdm** é a base do estorno de veterano e expert.
 * - **BonusIncentivo** é a gerência a que o bônus pertence.
 *
 * Nenhum valor é recalculado: valor é fato do relatório. Só o vínculo muda.
 */

export interface ResumoReligacao {
  orfas: number;
  religadas: number;
  /** Continuam órfãs: o relatório trouxe a venda e a base ainda não tem. */
  semCota: number;
}

export interface ResumoReligacaoGeral {
  comissaoWr: ResumoReligacao;
  comissaoVendedor: ResumoReligacao;
  bonus: ResumoReligacao;
  /** Soma das três — é o número que interessa para dizer se algo mudou. */
  religadas: number;
}

interface LinhaOrfa {
  id: string;
  administradoraId: string;
  grupo: string;
  cota: string;
  contrato: string;
}

export async function religarLancamentos(): Promise<ResumoReligacaoGeral> {
  const [comissaoWr, comissaoVendedor, bonus] = [
    await religar("comissaoRegistro"),
    await religar("comissaoVendedorAdm"),
    await religar("bonusIncentivo"),
  ];

  return {
    comissaoWr,
    comissaoVendedor,
    bonus,
    religadas: comissaoWr.religadas + comissaoVendedor.religadas + bonus.religadas,
  };
}

type Tabela = "comissaoRegistro" | "comissaoVendedorAdm" | "bonusIncentivo";

async function religar(tabela: Tabela): Promise<ResumoReligacao> {
  const orfas = await carregarOrfas(tabela);
  if (orfas.length === 0) return { orfas: 0, religadas: 0, semCota: 0 };

  const indice = await indiceDeCotas(orfas.map((linha) => linha.administradoraId));

  // Agrupa por cota para gravar em lote: são milhares de linhas por
  // fechamento, e um update por linha faria a apuração levar minutos.
  const porDestino = new Map<string, string[]>();
  let semCota = 0;

  for (const linha of orfas) {
    const cotaId =
      indice.porGrupoCota.get(`${linha.administradoraId}|${linha.grupo}|${linha.cota}`) ??
      indice.porContrato.get(`${linha.administradoraId}|${linha.contrato}`) ??
      null;

    if (!cotaId) {
      semCota += 1;
      continue;
    }

    porDestino.set(cotaId, [...(porDestino.get(cotaId) ?? []), linha.id]);
  }

  let religadas = 0;
  for (const [cotaId, ids] of porDestino) {
    religadas += await gravarVinculo(tabela, ids, cotaId);
  }

  return { orfas: orfas.length, religadas, semCota };
}

async function carregarOrfas(tabela: Tabela): Promise<LinhaOrfa[]> {
  const selecao = {
    id: true,
    administradoraId: true,
    grupo: true,
    cota: true,
    contrato: true,
  } as const;

  if (tabela === "comissaoRegistro") {
    return prisma.comissaoRegistro.findMany({ where: { cotaId: null }, select: selecao });
  }
  if (tabela === "comissaoVendedorAdm") {
    return prisma.comissaoVendedorAdm.findMany({ where: { cotaId: null }, select: selecao });
  }
  return prisma.bonusIncentivo.findMany({ where: { cotaId: null }, select: selecao });
}

async function gravarVinculo(
  tabela: Tabela,
  ids: string[],
  cotaId: string,
): Promise<number> {
  const onde = { where: { id: { in: ids } }, data: { cotaId } };

  if (tabela === "comissaoRegistro") {
    return (await prisma.comissaoRegistro.updateMany(onde)).count;
  }
  if (tabela === "comissaoVendedorAdm") {
    return (await prisma.comissaoVendedorAdm.updateMany(onde)).count;
  }
  return (await prisma.bonusIncentivo.updateMany(onde)).count;
}

/**
 * Índice das cotas por grupo+cota e por contrato.
 *
 * Grupo e cota primeiro, contrato como segunda chance: grupo e cota se repetem
 * entre contratos, então o contrato é o desempate natural quando a primeira
 * busca não acha nada.
 */
async function indiceDeCotas(administradoraIds: readonly string[]): Promise<{
  porGrupoCota: Map<string, string>;
  porContrato: Map<string, string>;
}> {
  const cotas = await prisma.cota.findMany({
    where: { administradoraId: { in: [...new Set(administradoraIds)] } },
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

  return { porGrupoCota, porContrato };
}

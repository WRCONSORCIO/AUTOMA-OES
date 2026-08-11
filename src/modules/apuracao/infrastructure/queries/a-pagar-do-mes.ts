import "server-only";
import type { DestinoComissao, PapelComissao } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calcularBaseComissao } from "@/server/domain/regras";
import {
  resolverTabelaInterna,
  type TabelaInterna,
} from "@/server/domain/tabelas-internas";
import { carregarTabelasInternas } from "@/server/services/tabelas-internas";

/**
 * O que a WR deve pagar à equipe no mês, a partir do que a administradora
 * pagou à WR nesse mês.
 *
 * **Se o cliente não paga, o vendedor não recebe.** É a regra do negócio, e
 * ela obriga o cálculo a partir do RELATÓRIO recebido, não da carteira: cada
 * linha do fechamento é uma parcela que entrou, e é ela que libera a comissão
 * daquela parcela.
 *
 * A tela mostrava o outro número — o total que a venda vai render ao longo do
 * plano inteiro, somando parcelas que talvez nunca sejam pagas. Serve para
 * projeção, não para folha: quem paga por ali paga adiantado por cliente
 * inadimplente.
 *
 * O percentual sai da faixa daquela PARCELA. É por isso que iniciante de
 * imóvel recebe nas parcelas 1 a 4 e nada na quinta — a tabela simplesmente
 * não tem faixa para a quinta, e a linha do relatório da quinta parcela não
 * gera pagamento nenhum.
 *
 * Derivado, nunca gravado: corrigir um percentual ou reimportar o relatório
 * muda a resposta na hora, sem reapuramento e sem linha velha sobrevivendo.
 */

export interface FiltroAPagar {
  de: Date;
  ate: Date;
  gerenciaId?: string;
  equipeId?: string;
  papel?: PapelComissao;
}

export interface LinhaAPagar {
  chave: string;
  papel: PapelComissao;
  beneficiario: string;
  /** Parcelas do relatório que geraram pagamento. */
  parcelas: number;
  /** Cotas distintas por trás dessas parcelas. */
  vendas: number;
  base: number;
  valor: number;
}

export interface ResumoAPagar {
  linhas: LinhaAPagar[];
  total: number;
  parcelas: number;
  /** Linhas do relatório que não geraram pagamento, e por quê. */
  semPagamento: {
    semCota: number;
    semTabela: number;
    parcelaNaoRemunerada: number;
  };
}

interface Acumulador {
  papel: PapelComissao;
  beneficiario: string;
  parcelas: number;
  cotas: Set<string>;
  base: number;
  valor: number;
}

export async function aPagarDoMes(filtro: FiltroAPagar): Promise<ResumoAPagar> {
  const [tabelas, lancamentos] = await Promise.all([
    carregarTabelasInternas(),
    prisma.comissaoRegistro.findMany({
      where: {
        status: "NORMAL",
        // Só o que é recebimento de parcela. Cancelamento de plano é devolução
        // e vive no módulo de estorno, não aqui.
        tipo: { in: ["PAGAMENTO_COMISSAO", "INCLUSAO_DE_PLANO"] },
        dataReferencia: { gte: filtro.de, lte: filtro.ate },
        ...(filtro.gerenciaId ? { gerenciaId: filtro.gerenciaId } : {}),
        ...(filtro.equipeId ? { equipeId: filtro.equipeId } : {}),
      },
      select: {
        cotaId: true,
        parcela: true,
        valorCredito: true,
        percentualFlex: true,
        categoriaVenda: true,
        segmentoVenda: true,
        dataVenda: true,
        equipeId: true,
        gerenciaId: true,
        vendedor: { select: { nome: true, pessoa: { select: { id: true, nome: true } } } },
        equipe: { select: { nome: true } },
        gerencia: { select: { nome: true } },
        cotaRef: {
          select: {
            categoriaVenda: true,
            segmentoVenda: true,
            dataVenda: true,
            equipeId: true,
            gerenciaId: true,
            vendedorEfetivo: {
              select: { nome: true, pessoa: { select: { id: true, nome: true } } },
            },
            equipe: { select: { nome: true } },
            gerencia: { select: { nome: true } },
          },
        },
      },
    }),
  ]);

  const acumulado = new Map<string, Acumulador>();
  const semPagamento = { semCota: 0, semTabela: 0, parcelaNaoRemunerada: 0 };
  let total = 0;
  let parcelasPagas = 0;

  for (const lancamento of lancamentos) {
    // A cota é a fonte da verdade dos snapshots quando o vínculo existe; sem
    // ela vale o que o próprio relatório trouxe.
    const cota = lancamento.cotaRef;
    const categoria = cota?.categoriaVenda ?? lancamento.categoriaVenda;
    const segmento = cota?.segmentoVenda ?? lancamento.segmentoVenda;
    const dataVenda = cota?.dataVenda ?? lancamento.dataVenda;

    if (!categoria || !segmento || !dataVenda) {
      semPagamento.semCota += 1;
      continue;
    }

    const base = calcularBaseComissao(
      Number(lancamento.valorCredito ?? 0),
      lancamento.percentualFlex === null ? null : Number(lancamento.percentualFlex),
    );

    const pessoa = cota?.vendedorEfetivo?.pessoa ?? lancamento.vendedor?.pessoa ?? null;
    const nomeVendedor =
      pessoa?.nome ?? cota?.vendedorEfetivo?.nome ?? lancamento.vendedor?.nome ?? null;

    const equipeId = cota?.equipeId ?? lancamento.equipeId;
    const gerenciaId = cota?.gerenciaId ?? lancamento.gerenciaId;
    const equipeNome = cota?.equipe?.nome ?? lancamento.equipe?.nome ?? null;
    const gerenciaNome = cota?.gerencia?.nome ?? lancamento.gerencia?.nome ?? null;

    const alvos: {
      papel: PapelComissao;
      destino: DestinoComissao;
      chave: string;
      beneficiario: string;
    }[] = [];

    if (nomeVendedor) {
      alvos.push({
        papel: "VENDEDOR",
        destino: categoria as unknown as DestinoComissao,
        chave: `VENDEDOR|${pessoa?.id ?? nomeVendedor}`,
        beneficiario: nomeVendedor,
      });
    }
    if (equipeId && equipeNome && equipeNome !== gerenciaNome) {
      alvos.push({
        papel: "SUPERVISOR",
        destino: "SUPERVISOR",
        chave: `SUPERVISOR|${equipeId}`,
        beneficiario: equipeNome,
      });
    }
    if (gerenciaId && gerenciaNome) {
      alvos.push({
        papel: "GERENCIA",
        destino: "GERENCIA",
        chave: `GERENCIA|${gerenciaId}`,
        beneficiario: gerenciaNome,
      });
    }

    let rendeu = false;

    for (const alvo of alvos) {
      if (filtro.papel && alvo.papel !== filtro.papel) continue;

      const valor = valorDaParcela(
        tabelas,
        alvo.destino,
        segmento,
        dataVenda,
        lancamento.parcela,
        base,
      );
      if (valor === null) continue;
      if (valor === 0) continue;

      rendeu = true;
      const atual =
        acumulado.get(alvo.chave) ??
        {
          papel: alvo.papel,
          beneficiario: alvo.beneficiario,
          parcelas: 0,
          cotas: new Set<string>(),
          base: 0,
          valor: 0,
        };

      atual.parcelas += 1;
      if (lancamento.cotaId) atual.cotas.add(lancamento.cotaId);
      atual.base += base;
      atual.valor += valor;
      acumulado.set(alvo.chave, atual);

      total += valor;
    }

    if (rendeu) parcelasPagas += 1;
    else if (alvos.length === 0) semPagamento.semCota += 1;
    else semPagamento.parcelaNaoRemunerada += 1;
  }

  const linhas = [...acumulado.entries()]
    .map(([chave, item]) => ({
      chave,
      papel: item.papel,
      beneficiario: item.beneficiario,
      parcelas: item.parcelas,
      vendas: item.cotas.size,
      base: arredondar(item.base),
      valor: arredondar(item.valor),
    }))
    .sort((a, b) => b.valor - a.valor);

  return {
    linhas,
    total: arredondar(total),
    parcelas: parcelasPagas,
    semPagamento,
  };
}

/**
 * Quanto aquela parcela vale para aquele destino.
 *
 * `null` = não há tabela vigente. Zero = há tabela, e ela não remunera esta
 * parcela — que é o caso de iniciante de imóvel na quinta em diante. Os dois
 * resultam em não pagar, mas por motivos diferentes, e só o primeiro é um
 * cadastro faltando.
 */
function valorDaParcela(
  tabelas: readonly TabelaInterna[],
  destino: DestinoComissao,
  segmento: "IMOVEL" | "AUTOMOVEL",
  dataVenda: Date,
  parcela: number,
  base: number,
): number | null {
  const tabela = resolverTabelaInterna(tabelas, destino, segmento, dataVenda);
  if (!tabela) return null;

  const faixa = tabela.faixas.find((item) => item.parcela === parcela);
  if (!faixa || faixa.percentual <= 0) return 0;

  return arredondar((base * faixa.percentual) / 100);
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

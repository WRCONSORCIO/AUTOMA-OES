import "server-only";
import { prisma } from "@/lib/prisma";
import {
  avaliarEstorno,
  type CategoriaVenda,
  type RegraEstornoVigente,
} from "../../domain/rules/estorno";
import { basesDoEstorno } from "../repositories/regras-estorno";

/**
 * O que ainda vai ser cobrado, mas a administradora ainda não debitou.
 *
 * A venda já caiu na base de clientes; o débito no relatório de comissão pode
 * levar dois meses. Nesse intervalo o estorno não existe — e está certo que
 * não exista, porque a WR ainda não perdeu nada. Mas quem monta a comissão do
 * mês precisa saber o que vem vindo: pagar hoje o valor cheio de um vendedor
 * que tem R$ 4.000 de estorno a caminho é dinheiro que depois se tenta
 * recuperar de alguém que já gastou.
 *
 * **Nunca grava nada.** É consulta derivada, calculada na hora a partir das
 * regras vigentes e dos fatos. Gravar transformaria previsão em cobrança, e a
 * diferença entre as duas é a coisa toda que o módulo de estorno protege: só
 * se cobra o que a administradora efetivamente tirou da WR.
 *
 * Por ser derivada, corrigir uma regra ou reimportar a base muda a previsão na
 * hora, sem reapuração e sem linha velha sobrevivendo.
 */

export interface FiltroPrevisao {
  pessoaId?: string;
  equipeId?: string;
  gerenciaId?: string;
}

export interface PrevisaoDaPessoa {
  pessoaId: string | null;
  pessoaNome: string;
  qtdRecuperacao: number;
  valorRecuperacao: number;
  qtdCancelamento: number;
  valorCancelamento: number;
  qtdTotal: number;
  valorTotal: number;
  /**
   * Vendas em que a regra manda cobrar e ainda não há comissão registrada
   * como base. Entram na contagem, valem zero, e o total real será maior.
   */
  semBase: number;
}

export interface ResumoPrevisao {
  linhas: PrevisaoDaPessoa[];
  recuperacao: number;
  cancelamento: number;
  total: number;
  vendas: number;
  /** Canceladas sem débito que a regra diz não gerar cobrança nenhuma. */
  semEstorno: number;
  /** Quantas das previstas ainda não têm base de comissão conhecida. */
  semBase: number;
}

export async function estornosPrevistos(
  filtro: FiltroPrevisao = {},
): Promise<ResumoPrevisao> {
  // Cancelada na base, sem o CANCELAMENTO DE PLANO no relatório. É exatamente
  // o complemento do que a tela de estornos já cobra.
  const canceladas = await prisma.cota.findMany({
    where: {
      situacao: "CANCELADO",
      dataCancelamento: { not: null },
      comissoes: { none: { tipo: "CANCELAMENTO_DE_PLANO" } },
      ...(filtro.equipeId ? { equipeId: filtro.equipeId } : {}),
      ...(filtro.gerenciaId ? { gerenciaId: filtro.gerenciaId } : {}),
      ...(filtro.pessoaId ? { vendedorEfetivo: { pessoaId: filtro.pessoaId } } : {}),
    },
    select: {
      id: true,
      vendedorEfetivoId: true,
      emRecuperacao: true,
      parcelasPagas: true,
      dataCancelamento: true,
      categoriaVenda: true,
      vendedorEfetivo: {
        select: { nome: true, pessoa: { select: { id: true, nome: true } } },
      },
    },
  });

  if (canceladas.length === 0) return vazio();

  const cotaIds = canceladas.map((cota) => cota.id);
  const [regras, base] = await Promise.all([carregarRegras(), basesDoEstorno(cotaIds)]);

  const acumulado = new Map<string, PrevisaoDaPessoa>();
  let semEstorno = 0;

  for (const cota of canceladas) {
    const valorReferencia = base.get(cota.id)?.valor ?? 0;

    const decisao = avaliarEstorno(
      {
        vendedorId: cota.vendedorEfetivoId,
        emRecuperacao: cota.emRecuperacao,
        parcelasPagas: cota.parcelasPagas,
        dataCancelamento: cota.dataCancelamento,
        valorReferencia,
        categoriaVenda: cota.categoriaVenda as CategoriaVenda | null,
      },
      // A precedência entre regra do vendedor e regra padrão é decidida no
      // domínio; aqui só se entrega o conjunto que pode valer para ele.
      regras.filter(
        (regra) => regra.vendedorId === null || regra.vendedorId === cota.vendedorEfetivoId,
      ),
    );

    if (!decisao.gera) {
      semEstorno += 1;
      continue;
    }

    const pessoa = cota.vendedorEfetivo?.pessoa ?? null;
    const chave = pessoa?.id ?? "sem-vinculo";

    const atual =
      acumulado.get(chave) ??
      ({
        pessoaId: pessoa?.id ?? null,
        // Venda cujo vendedor ainda não foi vinculado gera previsão do mesmo
        // jeito, e sumiria da tela sem um rótulo. Aparecer sem dono é o que
        // faz alguém ir atrás do vínculo.
        pessoaNome: pessoa?.nome ?? cota.vendedorEfetivo?.nome ?? "Vendedor não identificado",
        qtdRecuperacao: 0,
        valorRecuperacao: 0,
        qtdCancelamento: 0,
        valorCancelamento: 0,
        qtdTotal: 0,
        valorTotal: 0,
        semBase: 0,
      } satisfies PrevisaoDaPessoa);

    if (decisao.tipo === "RECUPERACAO") {
      atual.qtdRecuperacao += 1;
      atual.valorRecuperacao += decisao.valorEstorno;
    } else {
      atual.qtdCancelamento += 1;
      atual.valorCancelamento += decisao.valorEstorno;
    }

    atual.qtdTotal += 1;
    atual.valorTotal += decisao.valorEstorno;
    if (valorReferencia <= 0) atual.semBase += 1;

    acumulado.set(chave, atual);
  }

  const linhas = [...acumulado.values()]
    .map((linha) => ({
      ...linha,
      valorRecuperacao: arredondar(linha.valorRecuperacao),
      valorCancelamento: arredondar(linha.valorCancelamento),
      valorTotal: arredondar(linha.valorTotal),
    }))
    .sort((a, b) => b.valorTotal - a.valorTotal);

  return {
    linhas,
    recuperacao: arredondar(linhas.reduce((soma, l) => soma + l.valorRecuperacao, 0)),
    cancelamento: arredondar(linhas.reduce((soma, l) => soma + l.valorCancelamento, 0)),
    total: arredondar(linhas.reduce((soma, l) => soma + l.valorTotal, 0)),
    vendas: linhas.reduce((soma, l) => soma + l.qtdTotal, 0),
    semEstorno,
    semBase: linhas.reduce((soma, l) => soma + l.semBase, 0),
  };
}

function vazio(): ResumoPrevisao {
  return {
    linhas: [],
    recuperacao: 0,
    cancelamento: 0,
    total: 0,
    vendas: 0,
    semEstorno: 0,
    semBase: 0,
  };
}

/**
 * Todas as regras de uma vez.
 *
 * A apuração carrega as regras por vendedor, uma consulta por cota. Aqui são
 * centenas de cotas de uma vez e o conjunto de regras é pequeno — trazê-lo
 * inteiro e filtrar em memória troca centenas de idas ao banco por uma.
 */
async function carregarRegras(): Promise<RegraEstornoVigente[]> {
  const linhas = await prisma.regraEstorno.findMany({
    select: {
      id: true,
      vendedorId: true,
      tipo: true,
      categoriasVenda: true,
      parcelaLimite: true,
      percentual: true,
      vigenteDe: true,
      vigenteAte: true,
    },
  });

  return linhas.map((linha) => ({ ...linha, percentual: Number(linha.percentual) }));
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

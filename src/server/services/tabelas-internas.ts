import "server-only";

import { Prisma, type DestinoComissao, type SegmentoVenda } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "./auditoria";
import type { ContextoUsuario } from "./vendedores";
import {
  CARGA_INICIAL,
  FLEX_INICIAL,
  ROTULO_DESTINO,
  ROTULO_SEGMENTO,
  type TabelaInterna,
} from "@/server/domain/tabelas-internas";

/**
 * Persistência das cinco tabelas de comissão.
 *
 * Os percentuais da carga inicial vivem no domínio; aqui só se grava e se lê.
 */

/**
 * Cria o que ainda não existe, sem tocar no que já foi configurado.
 *
 * Roda com segurança quantas vezes for preciso: tabela já cadastrada para o
 * par destino/segmento é deixada como está, porque o percentual que vale é o
 * que a WR ajustou, não o da carga.
 */
/**
 * A data a partir da qual um percentual novo precisa valer para servir.
 *
 * A venda mais antiga da base. Percentual que começa hoje não alcança nada do
 * que já foi importado — e como esta tela não pede data, começar em "hoje"
 * produzia tabelas corretas que não calculavam nada, sem nada explicando.
 */
export async function inicioQueCobreABase(): Promise<Date> {
  const { _min } = await prisma.cota.aggregate({ _min: { dataVenda: true } });
  const referencia = _min.dataVenda ?? new Date();
  return new Date(
    Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), referencia.getUTCDate()),
  );
}

/**
 * Faz os percentuais já cadastrados valerem desde a venda mais antiga.
 *
 * Existe porque a tela de percentuais não pede data de vigência — e não
 * deveria mesmo pedir, para o caso comum. Mas quem cadastrou antes desta
 * correção ficou com tabelas começando no dia do cadastro, que não alcançam
 * nenhuma venda importada. Sem esta ação não haveria como consertar pela
 * interface.
 *
 * **Não altera percentual nenhum**, só a data a partir da qual eles contam. E
 * só recua: tabela que já cobre a base fica como está.
 */
export async function ajustarVigenciaParaCobrirBase(
  usuario: ContextoUsuario,
): Promise<{ ajustadas: number; inicio: Date }> {
  const inicio = await inicioQueCobreABase();

  const atrasadas = await prisma.tabelaComissaoInterna.findMany({
    where: { ativo: true, vigenteDe: { gt: inicio } },
    select: { id: true, destino: true, segmento: true, vigenteDe: true },
  });

  if (atrasadas.length === 0) return { ajustadas: 0, inicio };

  await prisma.tabelaComissaoInterna.updateMany({
    where: { id: { in: atrasadas.map((tabela) => tabela.id) } },
    data: { vigenteDe: inicio },
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissaoInterna",
    descricao:
      `Vigência de ${atrasadas.length} tabela(s) recuada para ${inicio.toISOString().slice(0, 10)}, ` +
      "para alcançar as vendas já importadas. Nenhum percentual foi alterado.",
    dadosAntes: { tabelas: atrasadas },
    dadosDepois: { vigenteDe: inicio },
    usuario,
  });

  return { ajustadas: atrasadas.length, inicio };
}

export async function semearTabelasInternas(
  usuario: ContextoUsuario,
  vigenteDe?: Date,
): Promise<{ tabelasCriadas: number; faixasCriadas: number; flexCriadas: number }> {
  // A vigência começa na VENDA MAIS ANTIGA da base, não hoje.
  //
  // Vinha de hoje, e o efeito era uma armadilha silenciosa: a carga inicial
  // criava as dez tabelas, a tela dizia que estava tudo cadastrado, e nenhuma
  // venda já importada era alcançada — porque todas são anteriores. O usuário
  // ficava com percentuais corretos e comissão zero, sem nada apontando o
  // motivo.
  //
  // Base vazia continua começando hoje: aí não há passado a cobrir.
  const inicio = vigenteDe
    ? new Date(
        Date.UTC(vigenteDe.getUTCFullYear(), vigenteDe.getUTCMonth(), vigenteDe.getUTCDate()),
      )
    : await inicioQueCobreABase();

  let tabelasCriadas = 0;
  let faixasCriadas = 0;

  for (const [destino, porSegmento] of Object.entries(CARGA_INICIAL)) {
    for (const [segmento, faixas] of Object.entries(porSegmento)) {
      const existente = await prisma.tabelaComissaoInterna.findFirst({
        where: {
          destino: destino as DestinoComissao,
          segmento: segmento as SegmentoVenda,
          ativo: true,
        },
      });
      if (existente) continue;

      await prisma.tabelaComissaoInterna.create({
        data: {
          destino: destino as DestinoComissao,
          segmento: segmento as SegmentoVenda,
          vigenteDe: inicio,
          faixas: {
            create: faixas.map(([parcela, percentual]) => ({
              parcela,
              percentual: new Prisma.Decimal(percentual.toFixed(4)),
            })),
          },
        },
      });

      tabelasCriadas += 1;
      faixasCriadas += faixas.length;
    }
  }

  let flexCriadas = 0;
  for (const percentual of FLEX_INICIAL) {
    const nome = percentual === 100 ? "Integral" : `Flex ${percentual}`;
    const existente = await prisma.modalidadeFlex.findFirst({
      where: { percentual: new Prisma.Decimal(percentual.toFixed(4)) },
    });
    if (existente) continue;

    await prisma.modalidadeFlex.create({
      data: { nome, percentual: new Prisma.Decimal(percentual.toFixed(4)) },
    });
    flexCriadas += 1;
  }

  if (tabelasCriadas > 0 || flexCriadas > 0) {
    await registrarAuditoria({
      acao: "CRIACAO",
      entidade: "TabelaComissaoInterna",
      descricao: `Carga inicial: ${tabelasCriadas} tabela(s) de comissão e ${flexCriadas} modalidade(s) de flex`,
      dadosDepois: { tabelasCriadas, faixasCriadas, flexCriadas },
      usuario,
    });
  }

  return { tabelasCriadas, faixasCriadas, flexCriadas };
}

export async function carregarTabelasInternas(): Promise<TabelaInterna[]> {
  const tabelas = await prisma.tabelaComissaoInterna.findMany({
    where: { ativo: true },
    include: { faixas: { orderBy: { parcela: "asc" } } },
    orderBy: [{ destino: "asc" }, { segmento: "asc" }, { vigenteDe: "desc" }],
  });

  return tabelas.map((tabela) => ({
    id: tabela.id,
    destino: tabela.destino,
    segmento: tabela.segmento,
    vigenteDe: tabela.vigenteDe,
    vigenteAte: tabela.vigenteAte,
    faixas: tabela.faixas.map((faixa) => ({
      parcela: faixa.parcela,
      percentual: Number(faixa.percentual),
    })),
  }));
}

/**
 * Grava os percentuais de uma tabela.
 *
 * Substitui as faixas inteiras: a tela manda o quadro completo, e parcela que
 * some da tela some da tabela. A auditoria guarda como estava antes.
 */
export async function salvarTabelaInterna(
  entrada: {
    destino: DestinoComissao;
    segmento: SegmentoVenda;
    faixas: { parcela: number; percentual: number }[];
  },
  usuario: ContextoUsuario,
): Promise<void> {
  const faixas = entrada.faixas
    .filter((faixa) => faixa.percentual > 0)
    .sort((a, b) => a.parcela - b.parcela);

  const atual = await prisma.tabelaComissaoInterna.findFirst({
    where: { destino: entrada.destino, segmento: entrada.segmento, ativo: true },
    include: { faixas: { orderBy: { parcela: "asc" } } },
    orderBy: { vigenteDe: "desc" },
  });

  const antes = atual?.faixas.map((faixa) => ({
    parcela: faixa.parcela,
    percentual: Number(faixa.percentual),
  }));

  await prisma.$transaction(async (tx) => {
    if (atual) {
      await tx.faixaComissaoInterna.deleteMany({ where: { tabelaId: atual.id } });
      await tx.tabelaComissaoInterna.update({
        where: { id: atual.id },
        data: {
          faixas: {
            create: faixas.map((faixa) => ({
              parcela: faixa.parcela,
              percentual: new Prisma.Decimal(faixa.percentual.toFixed(4)),
            })),
          },
        },
      });
      return;
    }

    await tx.tabelaComissaoInterna.create({
      data: {
        destino: entrada.destino,
        segmento: entrada.segmento,
        // Mesma razão da carga inicial: a tabela nasce valendo desde a venda
        // mais antiga da base, senão nasce sem alcançar nada.
        vigenteDe: await inicioQueCobreABase(),
        faixas: {
          create: faixas.map((faixa) => ({
            parcela: faixa.parcela,
            percentual: new Prisma.Decimal(faixa.percentual.toFixed(4)),
          })),
        },
      },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissaoInterna",
    entidadeId: atual?.id,
    descricao: `Percentuais de ${ROTULO_DESTINO[entrada.destino]} — ${ROTULO_SEGMENTO[entrada.segmento]} atualizados`,
    dadosAntes: antes ? { faixas: antes } : undefined,
    dadosDepois: { faixas },
    usuario,
  });
}

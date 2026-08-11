import "server-only";

import {
  Prisma,
  type CategoriaVendedor,
  type DestinoComissao,
  type PapelComissao,
  type SegmentoVenda,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import { type ContextoVenda } from "@/server/domain/comissao-equipe";
import {
  apurarVendaPorParcelas,
  remuneraSupervisaoEGerencia,
  resolverTabelaInterna,
  ROTULO_DESTINO,
  ROTULO_SEGMENTO,
  type TabelaInterna,
} from "@/server/domain/tabelas-internas";
import { carregarTabelasInternas } from "./tabelas-internas";
import { resolverPorVigencia } from "@/server/domain/vigencia";
import { registrarAuditoria } from "./auditoria";
import type { ContextoUsuario } from "./vendedores";

const TAMANHO_LOTE = 500;

export interface ResumoApuracaoEquipe {
  cotasAvaliadas: number;
  cotasComTabela: number;
  cotasSemTabela: number;
  linhasGravadas: number;
  linhasRemovidas: number;
  valorPrevisto: number;
  valorLiberado: number;
}

/**
 * Apura a comissão que a WR deve à própria equipe sobre cada venda.
 *
 * Tudo aqui é derivado: a fonte da verdade são as tabelas cadastradas pelo
 * RH/financeiro e os snapshots já fixados na cota (categoria da venda, equipe e
 * gerência do momento da venda). Rodar de novo com as mesmas tabelas produz
 * exatamente o mesmo resultado, então a apuração pode ser repetida à vontade.
 *
 * A tabela usada é a vigente NA DATA DA VENDA, pelo mesmo motivo da categoria:
 * mudar os percentuais hoje não pode reescrever o que já foi vendido — basta
 * fechar a vigência da tabela antiga e abrir a nova.
 */
export async function apurarComissoesEquipe(options?: {
  usuario?: ContextoUsuario;
  cotaIds?: string[];
  registrarAuditoria?: boolean;
}): Promise<ResumoApuracaoEquipe> {
  const resumo: ResumoApuracaoEquipe = {
    cotasAvaliadas: 0,
    cotasComTabela: 0,
    cotasSemTabela: 0,
    linhasGravadas: 0,
    linhasRemovidas: 0,
    valorPrevisto: 0,
    valorLiberado: 0,
  };

  const tabelas = await carregarTabelasInternas();
  const unidades = await carregarUnidades();

  const filtroCotas: Prisma.CotaWhereInput = {
    categoriaVenda: { not: null },
    dataVenda: { not: null },
    ...(options?.cotaIds ? { id: { in: options.cotaIds } } : {}),
  };

  let cursor: string | undefined;

  for (;;) {
    const cotas = await prisma.cota.findMany({
      where: filtroCotas,
      select: {
        id: true,
        dataVenda: true,
        categoriaVenda: true,
        valorCredito: true,
        temFlex: true,
        taxaFlex: true,
        segmentoVenda: true,
        equipeId: true,
        gerenciaId: true,
        vendedorEfetivoId: true,
        vendedorEfetivo: { select: { pessoaId: true } },
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: TAMANHO_LOTE,
    });

    if (cotas.length === 0) break;
    cursor = cotas.at(-1)!.id;

    const ids = cotas.map((cota) => cota.id);
    const [recebidas, gravadas] = await Promise.all([
      contarParcelasRecebidas(ids),
      carregarLinhasGravadas(ids),
    ]);

    const desejadas: LinhaDesejada[] = [];

    for (const cota of cotas) {
      resumo.cotasAvaliadas += 1;

      const categoria = cota.categoriaVenda!;

      const equipe = cota.equipeId ? unidades.equipes.get(cota.equipeId) : undefined;
      const gerencia = cota.gerenciaId ? unidades.gerencias.get(cota.gerenciaId) : undefined;

      const contexto: ContextoVenda = {
        valorCredito: Number(cota.valorCredito ?? 0),
        percentualFlex: cota.temFlex && cota.taxaFlex ? Number(cota.taxaFlex) : null,
        equipeId: cota.equipeId,
        gerenciaId: cota.gerenciaId,
        equipeHabilitada: equipe?.habilitadaComissao ?? false,
        // A supervisão é o próprio gerente quando a equipe leva o nome dele.
        supervisaoIgualGerencia:
          equipe !== undefined &&
          gerencia !== undefined &&
          normalizarTexto(equipe.nome) === normalizarTexto(gerencia.nome),
      };

      const parcelasRecebidas = recebidas.get(cota.id) ?? 0;
      let rendeuAlgo = false;

      for (const { papel, destinoTabela } of papeisDaVenda(contexto, categoria)) {
        const tabela = resolverTabelaInterna(
          tabelas,
          // O vendedor é pago pela tabela da CATEGORIA da venda; supervisão e
          // gerência têm tabelas próprias, iguais para toda venda.
          papel === "VENDEDOR" ? (categoria as DestinoComissao) : destinoTabela,
          cota.segmentoVenda,
          cota.dataVenda!,
        );

        if (!tabela) continue;

        const apuracao = apurarVendaPorParcelas({
          tabela,
          valorCredito: Number(cota.valorCredito ?? 0),
          percentualFlex: cota.temFlex && cota.taxaFlex ? Number(cota.taxaFlex) : null,
          parcelasRecebidas,
        });

        if (apuracao.previsto === 0) continue;
        rendeuAlgo = true;

        const destino = destinatario(papel, {
          pessoaId: cota.vendedorEfetivo?.pessoaId ?? null,
          equipeId: cota.equipeId,
          gerenciaId: cota.gerenciaId,
        });

        desejadas.push({
          cotaId: cota.id,
          papel,
          categoriaVenda: categoria,
          ...destino,
          baseCalculo: apuracao.baseCalculo,
          percentual: apuracao.percentualTotal,
          valorPrevisto: apuracao.previsto,
          valorLiberado: apuracao.liberado,
          parcelasRecebidas,
          // A tabela de origem é a interna, que não é a referenciada pela
          // chave estrangeira antiga. O nome legível vai no campo de texto,
          // que é o que a tela mostra.
          tabelaId: null,
          regraId: null,
          regra: `${ROTULO_DESTINO[papel === "VENDEDOR" ? (categoria as DestinoComissao) : destinoTabela]} · ${ROTULO_SEGMENTO[cota.segmentoVenda!]}`,
        });
      }

      // "Com tabela" passa a significar "rendeu alguma linha". Antes bastava
      // existir a tabela da categoria; agora cada papel resolve a sua, e uma
      // venda pode ter a do vendedor e não a da gerência.
      if (rendeuAlgo) resumo.cotasComTabela += 1;
      else resumo.cotasSemTabela += 1;
    }

    resumo.linhasRemovidas += await removerObsoletas(gravadas, desejadas);

    const novas: LinhaDesejada[] = [];
    const alteradas: LinhaDesejada[] = [];

    for (const linha of desejadas) {
      resumo.valorPrevisto += linha.valorPrevisto;
      resumo.valorLiberado += linha.valorLiberado;

      const atual = gravadas.get(`${linha.cotaId}|${linha.papel}`);
      if (!atual) novas.push(linha);
      else if (!naoMudou(atual, linha)) alteradas.push(linha);
    }

    resumo.linhasGravadas += await gravarLinhas(novas, alteradas);

    if (options?.cotaIds && cotas.length < TAMANHO_LOTE) break;
  }

  resumo.valorPrevisto = Math.round(resumo.valorPrevisto * 100) / 100;
  resumo.valorLiberado = Math.round(resumo.valorLiberado * 100) / 100;

  if (options?.registrarAuditoria !== false && options?.usuario) {
    await registrarAuditoria({
      acao: "RECALCULO_COMISSAO",
      entidade: "ComissaoEquipe",
      descricao: `Apuração da comissão da equipe: ${resumo.linhasGravadas} linha(s) sobre ${resumo.cotasComTabela} venda(s)`,
      dadosDepois: resumo,
      usuario: options.usuario,
    });
  }

  return resumo;
}

/**
 * Quais papéis a venda remunera.
 *
 * O vendedor sempre. A supervisão só quando ela e a gerência são unidades
 * diferentes — quando a equipe leva o nome do próprio gerente, pagar os dois
 * seria pagar a mesma pessoa duas vezes pela mesma venda. A gerência quando a
 * venda tem gerência.
 *
 * Veterano e expert entram como vendedor do mesmo jeito, e é de propósito: a
 * WR não desembolsa nada por essas vendas, mas precisa do valor calculado para
 * saber quanto cobrar de volta quando a venda cai.
 */
function papeisDaVenda(
  contexto: ContextoVenda,
  categoriaVenda: CategoriaVendedor,
): { papel: PapelComissao; destinoTabela: DestinoComissao }[] {
  const papeis: { papel: PapelComissao; destinoTabela: DestinoComissao }[] = [
    { papel: "VENDEDOR", destinoTabela: "INICIANTE" },
  ];

  // Supervisão e gerência saem do mesmo bolso que a comissão do iniciante — o
  // da WR. Venda de veterano ou expert é paga pela administradora, e não há de
  // onde tirar os outros dois papéis.
  if (!remuneraSupervisaoEGerencia(categoriaVenda)) return papeis;

  if (contexto.equipeId && !contexto.supervisaoIgualGerencia) {
    papeis.push({ papel: "SUPERVISOR", destinoTabela: "SUPERVISOR" });
  }
  if (contexto.gerenciaId) {
    papeis.push({ papel: "GERENCIA", destinoTabela: "GERENCIA" });
  }

  return papeis;
}

/** Quem recebe cada papel: o vendedor é pessoa, supervisão e gerência são unidades. */
function destinatario(
  papel: PapelComissao,
  destinos: { pessoaId: string | null; equipeId: string | null; gerenciaId: string | null },
): { pessoaId: string | null; equipeId: string | null; gerenciaId: string | null } {
  switch (papel) {
    case "VENDEDOR":
      return { pessoaId: destinos.pessoaId, equipeId: destinos.equipeId, gerenciaId: destinos.gerenciaId };
    case "SUPERVISOR":
      return { pessoaId: null, equipeId: destinos.equipeId, gerenciaId: destinos.gerenciaId };
    case "GERENCIA":
      return { pessoaId: null, equipeId: null, gerenciaId: destinos.gerenciaId };
    default:
      return { pessoaId: null, equipeId: null, gerenciaId: null };
  }
}

interface LinhaDesejada {
  cotaId: string;
  papel: PapelComissao;
  categoriaVenda: CategoriaVendedor;
  pessoaId: string | null;
  equipeId: string | null;
  gerenciaId: string | null;
  baseCalculo: number;
  percentual: number;
  valorPrevisto: number;
  valorLiberado: number;
  parcelasRecebidas: number;
  tabelaId: string | null;
  regraId: string | null;
  regra: string;
}

type LinhaGravada = Omit<LinhaDesejada, "cotaId" | "papel">;

function dadosDaLinha(linha: LinhaDesejada) {
  return {
    categoriaVenda: linha.categoriaVenda,
    pessoaId: linha.pessoaId,
    equipeId: linha.equipeId,
    gerenciaId: linha.gerenciaId,
    baseCalculo: new Prisma.Decimal(linha.baseCalculo.toFixed(2)),
    percentual: new Prisma.Decimal(linha.percentual.toFixed(4)),
    valorPrevisto: new Prisma.Decimal(linha.valorPrevisto.toFixed(2)),
    valorLiberado: new Prisma.Decimal(linha.valorLiberado.toFixed(2)),
    parcelasRecebidas: linha.parcelasRecebidas,
    tabelaId: linha.tabelaId,
    regraId: linha.regraId,
    regra: linha.regra,
    calculadoEm: new Date(),
  };
}

/**
 * Grava o lote inteiro numa transação só.
 *
 * A separação entre novas e alteradas vem de graça: as linhas já gravadas foram
 * lidas para decidir o que mudou, então saber quais existem não custa consulta
 * nenhuma. Isso permite trocar um `upsert` por linha — que era uma ida ao banco
 * para cada uma das milhares de comissões de uma importação — por um
 * `createMany` e os poucos `update` do que de fato mudou.
 */
async function gravarLinhas(
  novas: readonly LinhaDesejada[],
  alteradas: readonly LinhaDesejada[],
): Promise<number> {
  if (novas.length === 0 && alteradas.length === 0) return 0;

  const operacoes: Prisma.PrismaPromise<unknown>[] = [];

  if (novas.length > 0) {
    operacoes.push(
      prisma.comissaoEquipe.createMany({
        data: novas.map((linha) => ({
          cotaId: linha.cotaId,
          papel: linha.papel,
          ...dadosDaLinha(linha),
        })),
      }),
    );
  }

  for (const linha of alteradas) {
    operacoes.push(
      prisma.comissaoEquipe.update({
        where: { cotaId_papel: { cotaId: linha.cotaId, papel: linha.papel } },
        data: dadosDaLinha(linha),
      }),
    );
  }

  try {
    await prisma.$transaction(operacoes);
  } catch {
    // Outra apuração rodando ao mesmo tempo pode ter inserido a linha entre a
    // leitura e a gravação, e aí o `createMany` inteiro cai. O `upsert` linha a
    // linha resolve o conflito e é lento o bastante para não valer como caminho
    // normal — mas é o certo como saída de emergência.
    for (const linha of [...novas, ...alteradas]) {
      const dados = dadosDaLinha(linha);
      await prisma.comissaoEquipe.upsert({
        where: { cotaId_papel: { cotaId: linha.cotaId, papel: linha.papel } },
        create: { cotaId: linha.cotaId, papel: linha.papel, ...dados },
        update: dados,
      });
    }
  }

  return novas.length + alteradas.length;
}

/** Reapurar não pode reescrever linhas idênticas: evita gravação e ruído. */
function naoMudou(atual: LinhaGravada, nova: LinhaDesejada): boolean {
  return (
    atual.categoriaVenda === nova.categoriaVenda &&
    atual.pessoaId === nova.pessoaId &&
    atual.equipeId === nova.equipeId &&
    atual.gerenciaId === nova.gerenciaId &&
    atual.baseCalculo === nova.baseCalculo &&
    atual.percentual === nova.percentual &&
    atual.valorPrevisto === nova.valorPrevisto &&
    atual.valorLiberado === nova.valorLiberado &&
    atual.parcelasRecebidas === nova.parcelasRecebidas &&
    atual.tabelaId === nova.tabelaId &&
    atual.regraId === nova.regraId
  );
}

async function carregarLinhasGravadas(
  cotaIds: string[],
): Promise<Map<string, LinhaGravada>> {
  if (cotaIds.length === 0) return new Map();

  const linhas = await prisma.comissaoEquipe.findMany({
    where: { cotaId: { in: cotaIds } },
  });

  return new Map(
    linhas.map((linha) => [
      `${linha.cotaId}|${linha.papel}`,
      {
        categoriaVenda: linha.categoriaVenda,
        pessoaId: linha.pessoaId,
        equipeId: linha.equipeId,
        gerenciaId: linha.gerenciaId,
        baseCalculo: Number(linha.baseCalculo),
        percentual: Number(linha.percentual),
        valorPrevisto: Number(linha.valorPrevisto),
        valorLiberado: Number(linha.valorLiberado),
        parcelasRecebidas: linha.parcelasRecebidas,
        tabelaId: linha.tabelaId ?? "",
        regraId: linha.regraId ?? "",
        regra: linha.regra,
      },
    ]),
  );
}

/**
 * Apaga a apuração que deixou de valer.
 *
 * A tabela é derivada, não é histórico: se a regra saiu, a linha sai junto — o
 * que fica registrado é a execução da apuração na auditoria.
 */
async function removerObsoletas(
  gravadas: Map<string, LinhaGravada>,
  desejadas: LinhaDesejada[],
): Promise<number> {
  const manter = new Set(desejadas.map((linha) => `${linha.cotaId}|${linha.papel}`));
  const remover = [...gravadas.keys()].filter((chave) => !manter.has(chave));
  if (remover.length === 0) return 0;

  const { count } = await prisma.comissaoEquipe.deleteMany({
    where: {
      OR: remover.map((chave) => {
        const [cotaId, papel] = chave.split("|");
        return { cotaId: cotaId!, papel: papel as PapelComissao };
      }),
    },
  });

  return count;
}

/**
 * Quantas parcelas da venda a WR já recebeu da administradora.
 *
 * Só conta lançamentos normais: estorno e cancelamento não liberam comissão.
 */
async function contarParcelasRecebidas(cotaIds: string[]): Promise<Map<string, number>> {
  if (cotaIds.length === 0) return new Map();

  const linhas = await prisma.$queryRaw<{ cotaId: string; parcelas: bigint }[]>`
    SELECT "cotaId", COUNT(DISTINCT "parcela") AS parcelas
      FROM "ComissaoRegistro"
     WHERE "cotaId" IN (${Prisma.join(cotaIds)})
       AND "status" = 'NORMAL'
       AND "tipo" IN ('PAGAMENTO_COMISSAO', 'INCLUSAO_DE_PLANO')
     GROUP BY 1
  `;

  return new Map(linhas.map((linha) => [linha.cotaId, Number(linha.parcelas)]));
}

async function carregarUnidades(): Promise<{
  equipes: Map<string, { nome: string; habilitadaComissao: boolean }>;
  gerencias: Map<string, { nome: string }>;
}> {
  const [equipes, gerencias] = await Promise.all([
    prisma.equipe.findMany({ select: { id: true, nome: true, habilitadaComissao: true } }),
    prisma.gerencia.findMany({ select: { id: true, nome: true } }),
  ]);

  return {
    equipes: new Map(
      equipes.map((equipe) => [
        equipe.id,
        { nome: equipe.nome, habilitadaComissao: equipe.habilitadaComissao },
      ]),
    ),
    gerencias: new Map(gerencias.map((gerencia) => [gerencia.id, { nome: gerencia.nome }])),
  };
}

export interface LacunaDeTabela {
  destino: DestinoComissao;
  segmento: SegmentoVenda | null;
  ano: number;
  vendas: number;
  credito: number;
  /**
   * `AUSENTE` = não há percentual cadastrado para o destino e o produto.
   * `VIGENCIA` = há, mas começa depois das vendas deste ano.
   *
   * A distinção é o que separa "preencher a tabela" de "corrigir a data", que
   * são trabalhos diferentes e levam a telas diferentes.
   */
  motivo: "AUSENTE" | "VIGENCIA";
  /** Início da vigência mais antiga cadastrada, quando o motivo é VIGENCIA. */
  vigenteDe: Date | null;
}

/**
 * Vendas com categoria resolvida que mesmo assim não têm tabela vigente.
 *
 * Sem isto, a falta de tabela é silenciosa: a venda tem categoria, tem
 * vendedor, tem equipe — e simplesmente não aparece comissão nenhuma, sem erro
 * e sem aviso. Quem cadastrou os percentuais de uma categoria e esqueceu os de
 * outra não tem como descobrir a não ser desconfiando do total.
 *
 * O agrupamento é por destino, segmento e ano porque é exatamente a chave de
 * uma tabela na tela de Regras e percentuais: quem lê o resultado sabe o que
 * preencher sem traduzir nada.
 */
export async function lacunasDeTabela(): Promise<LacunaDeTabela[]> {
  const tabelas = await carregarTabelasInternas();

  const grupos = await prisma.$queryRaw<
    {
      categoria: CategoriaVendedor;
      segmento: SegmentoVenda | null;
      ano: number;
      vendas: bigint;
      credito: Prisma.Decimal;
    }[]
  >`
    SELECT c."categoriaVenda" AS categoria,
           c."segmentoVenda"  AS segmento,
           EXTRACT(YEAR FROM c."dataVenda")::int AS ano,
           COUNT(*) AS vendas,
           COALESCE(SUM(c."valorCredito"), 0) AS credito
    FROM "Cota" c
    WHERE c."categoriaVenda" IS NOT NULL
      AND c."dataVenda" IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY 3 DESC, 1
  `;

  const lacunas: LacunaDeTabela[] = [];

  for (const grupo of grupos) {
    // Meio do ano como data de teste. Uma tabela que cobre só parte do ano
    // aparece ou não conforme o mês; é aproximação assumida, e o preço de
    // errar é mostrar uma linha a mais para conferir — nunca esconder uma.
    const referencia = new Date(Date.UTC(grupo.ano, 6, 1));
    const destino = grupo.categoria as unknown as DestinoComissao;

    if (resolverTabelaInterna(tabelas, destino, grupo.segmento, referencia)) continue;

    // Existe tabela para a combinação, só não alcança esta data? É outro
    // problema, com outra correção.
    const doDestino = tabelas.filter(
      (tabela) => tabela.destino === destino && tabela.segmento === grupo.segmento,
    );
    const maisAntiga = doDestino
      .map((tabela) => tabela.vigenteDe)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    lacunas.push({
      destino,
      segmento: grupo.segmento,
      ano: grupo.ano,
      vendas: Number(grupo.vendas),
      credito: Number(grupo.credito),
      motivo: doDestino.length > 0 ? "VIGENCIA" : "AUSENTE",
      vigenteDe: maisAntiga ?? null,
    });
  }

  return lacunas;
}

// ---------------------------------------------------------------------------
// Consulta para as telas
// ---------------------------------------------------------------------------

export interface FiltroComissaoEquipe {
  de?: Date;
  ate?: Date;
  papel?: PapelComissao;
  categoria?: CategoriaVendedor;
  gerenciaId?: string;
  equipeId?: string;
  pessoaId?: string;
}

export interface LinhaComissaoEquipe {
  chave: string;
  papel: PapelComissao;
  beneficiario: string;
  vendas: number;
  base: number;
  previsto: number;
  liberado: number;
  aLiberar: number;
}

export interface TotaisComissaoEquipe {
  vendas: number;
  previsto: number;
  liberado: number;
  aLiberar: number;
}

export interface PainelComissaoEquipe {
  linhas: LinhaComissaoEquipe[];
  totais: TotaisComissaoEquipe;
  porPapel: Record<PapelComissao, TotaisComissaoEquipe>;
}

interface LinhaBruta {
  chave: string | null;
  papel: PapelComissao;
  beneficiario: string | null;
  vendas: bigint;
  base: Prisma.Decimal | null;
  previsto: Prisma.Decimal | null;
  liberado: Prisma.Decimal | null;
}

function zerado(): TotaisComissaoEquipe {
  return { vendas: 0, previsto: 0, liberado: 0, aLiberar: 0 };
}

/**
 * Consolida a comissão da equipe por beneficiário.
 *
 * O previsto é o que a venda gera pela tabela; o liberado é a parte já coberta
 * pelos recebimentos da administradora. A diferença é o que ainda está preso à
 * espera de parcela.
 *
 * O escopo do usuário sempre prevalece sobre o filtro escolhido na tela, e é
 * aplicado sobre a unidade da própria linha — quem enxerga só a equipe não vê a
 * comissão da gerência, que não pertence a nenhuma equipe.
 */
export async function carregarPainelComissaoEquipe(
  filtro: FiltroComissaoEquipe,
  escopo: { gerenciaId?: string; equipeId?: string },
): Promise<PainelComissaoEquipe> {
  const condicoes: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (filtro.de) condicoes.push(Prisma.sql`c."dataVenda" >= ${filtro.de}`);
  if (filtro.ate) condicoes.push(Prisma.sql`c."dataVenda" <= ${filtro.ate}`);
  if (filtro.papel) condicoes.push(Prisma.sql`ce."papel"::text = ${filtro.papel}`);
  if (filtro.categoria) {
    condicoes.push(Prisma.sql`ce."categoriaVenda"::text = ${filtro.categoria}`);
  }
  if (filtro.pessoaId) condicoes.push(Prisma.sql`ce."pessoaId" = ${filtro.pessoaId}`);

  const gerenciaId = escopo.gerenciaId ?? filtro.gerenciaId;
  const equipeId = escopo.equipeId ?? filtro.equipeId;
  if (gerenciaId) condicoes.push(Prisma.sql`ce."gerenciaId" = ${gerenciaId}`);
  if (equipeId) condicoes.push(Prisma.sql`ce."equipeId" = ${equipeId}`);

  const onde = Prisma.join(condicoes, " AND ");

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT CASE ce."papel"
             WHEN 'VENDEDOR'  THEN ce."pessoaId"
             WHEN 'SUPERVISOR' THEN ce."equipeId"
             ELSE ce."gerenciaId"
           END                          AS chave,
           ce."papel"                   AS papel,
           CASE ce."papel"
             WHEN 'VENDEDOR'  THEN p."nome"
             WHEN 'SUPERVISOR' THEN e."nome"
             ELSE g."nome"
           END                          AS beneficiario,
           COUNT(*)                     AS vendas,
           SUM(ce."baseCalculo")        AS base,
           SUM(ce."valorPrevisto")      AS previsto,
           SUM(ce."valorLiberado")      AS liberado
      FROM "ComissaoEquipe" ce
      JOIN "Cota" c        ON c."id" = ce."cotaId"
      LEFT JOIN "Pessoa" p   ON p."id" = ce."pessoaId"
      LEFT JOIN "Equipe" e   ON e."id" = ce."equipeId"
      LEFT JOIN "Gerencia" g ON g."id" = ce."gerenciaId"
     WHERE ${onde}
     GROUP BY 1, 2, 3
     ORDER BY previsto DESC
     LIMIT 500
  `;

  const painel: PainelComissaoEquipe = {
    linhas: [],
    totais: zerado(),
    porPapel: { VENDEDOR: zerado(), SUPERVISOR: zerado(), GERENCIA: zerado() },
  };

  for (const linha of linhas) {
    const previsto = arredondar(linha.previsto);
    const liberado = arredondar(linha.liberado);
    const vendas = Number(linha.vendas);
    const aLiberar = arredondar(previsto - liberado);

    painel.linhas.push({
      chave: linha.chave ?? `${linha.papel}-sem-vinculo`,
      papel: linha.papel,
      beneficiario: linha.beneficiario ?? "Sem vínculo",
      vendas,
      base: arredondar(linha.base),
      previsto,
      liberado,
      aLiberar,
    });

    for (const alvo of [painel.totais, painel.porPapel[linha.papel]]) {
      alvo.vendas += vendas;
      alvo.previsto = arredondar(alvo.previsto + previsto);
      alvo.liberado = arredondar(alvo.liberado + liberado);
      alvo.aLiberar = arredondar(alvo.aLiberar + aLiberar);
    }
  }

  return painel;
}

function arredondar(valor: Prisma.Decimal | number | null): number {
  return Math.round(Number(valor ?? 0) * 100) / 100;
}

/** Comissão da equipe venda a venda, para a ficha da pessoa e a conferência. */
export async function carregarComissoesDaPessoa(
  pessoaId: string,
  limite = 200,
): Promise<
  {
    cotaId: string;
    grupo: string;
    cota: string;
    nomeCliente: string;
    dataVenda: Date | null;
    categoriaVenda: CategoriaVendedor;
    baseCalculo: number;
    percentual: number;
    previsto: number;
    liberado: number;
    parcelasRecebidas: number;
  }[]
> {
  const linhas = await prisma.comissaoEquipe.findMany({
    where: { pessoaId, papel: "VENDEDOR" },
    select: {
      cotaId: true,
      categoriaVenda: true,
      baseCalculo: true,
      percentual: true,
      valorPrevisto: true,
      valorLiberado: true,
      parcelasRecebidas: true,
      cota: {
        select: { grupo: true, cota: true, nomeCliente: true, dataVenda: true },
      },
    },
    orderBy: { cota: { dataVenda: "desc" } },
    take: limite,
  });

  return linhas.map((linha) => ({
    cotaId: linha.cotaId,
    grupo: linha.cota.grupo,
    cota: linha.cota.cota,
    nomeCliente: linha.cota.nomeCliente,
    dataVenda: linha.cota.dataVenda,
    categoriaVenda: linha.categoriaVenda,
    baseCalculo: Number(linha.baseCalculo),
    percentual: Number(linha.percentual),
    previsto: Number(linha.valorPrevisto),
    liberado: Number(linha.valorLiberado),
    parcelasRecebidas: linha.parcelasRecebidas,
  }));
}

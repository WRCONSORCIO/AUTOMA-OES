import "server-only";

import {
  Prisma,
  type CategoriaVendedor,
  type PapelComissao,
  type SegmentoVenda,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import {
  apurarComissaoEquipe,
  calcularLiberado,
  type ContextoVenda,
  type RegraPapel,
} from "@/server/domain/comissao-equipe";
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

interface TabelaVigente {
  id: string;
  nome: string;
  categoria: CategoriaVendedor;
  segmento: SegmentoVenda | null;
  vigenteDe: Date;
  vigenteAte: Date | null;
  parcelasParaLiberacao: number;
  regras: RegraPapel[];
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

  const tabelas = await carregarTabelasEquipe();
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
      const tabela = resolverTabela(
        tabelas,
        categoria,
        cota.segmentoVenda,
        cota.dataVenda!,
      );

      if (!tabela) {
        // Sem tabela vigente não há o que pagar: a apuração anterior sai junto.
        resumo.cotasSemTabela += 1;
        continue;
      }

      resumo.cotasComTabela += 1;

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

      for (const linha of apurarComissaoEquipe(tabela.regras, contexto)) {
        const destino = destinatario(linha.papel, {
          pessoaId: cota.vendedorEfetivo?.pessoaId ?? null,
          equipeId: cota.equipeId,
          gerenciaId: cota.gerenciaId,
        });

        desejadas.push({
          cotaId: cota.id,
          papel: linha.papel,
          categoriaVenda: categoria,
          ...destino,
          baseCalculo: linha.baseCalculo,
          percentual: linha.percentual,
          valorPrevisto: linha.valor,
          valorLiberado: calcularLiberado(
            linha.valor,
            parcelasRecebidas,
            tabela.parcelasParaLiberacao,
          ),
          parcelasRecebidas,
          tabelaId: tabela.id,
          regraId: linha.regraId,
          regra: tabela.nome,
        });
      }
    }

    resumo.linhasRemovidas += await removerObsoletas(gravadas, desejadas);

    for (const linha of desejadas) {
      resumo.valorPrevisto += linha.valorPrevisto;
      resumo.valorLiberado += linha.valorLiberado;

      const atual = gravadas.get(`${linha.cotaId}|${linha.papel}`);
      if (atual && naoMudou(atual, linha)) continue;

      await gravarLinha(linha);
      resumo.linhasGravadas += 1;
    }

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
  tabelaId: string;
  regraId: string;
  regra: string;
}

type LinhaGravada = Omit<LinhaDesejada, "cotaId" | "papel">;

async function gravarLinha(linha: LinhaDesejada): Promise<void> {
  const dados = {
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

  await prisma.comissaoEquipe.upsert({
    where: { cotaId_papel: { cotaId: linha.cotaId, papel: linha.papel } },
    create: { cotaId: linha.cotaId, papel: linha.papel, ...dados },
    update: dados,
  });
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

export async function carregarTabelasEquipe(): Promise<TabelaVigente[]> {
  const tabelas = await prisma.tabelaComissaoEquipe.findMany({
    where: { ativo: true },
    include: { regras: { orderBy: { papel: "asc" } } },
    orderBy: [{ categoria: "asc" }, { vigenteDe: "desc" }],
  });

  return tabelas.map((tabela) => ({
    id: tabela.id,
    nome: tabela.nome,
    categoria: tabela.categoria,
    segmento: tabela.segmento,
    vigenteDe: tabela.vigenteDe,
    vigenteAte: tabela.vigenteAte,
    parcelasParaLiberacao: tabela.parcelasParaLiberacao,
    regras: tabela.regras.map((regra) => ({
      id: regra.id,
      papel: regra.papel,
      percentual: Number(regra.percentual),
      condicao: regra.condicao,
    })),
  }));
}

/**
 * A tabela vigente na data da venda, específica do segmento quando existir.
 * Mesma resolução da tabela da WR — a regra de vigência é uma só.
 */
function resolverTabela(
  tabelas: TabelaVigente[],
  categoria: CategoriaVendedor,
  segmento: SegmentoVenda | null,
  dataVenda: Date,
): TabelaVigente | null {
  return resolverPorVigencia(tabelas, categoria, segmento, dataVenda);
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

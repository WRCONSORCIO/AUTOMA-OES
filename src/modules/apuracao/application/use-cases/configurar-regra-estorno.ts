import "server-only";
import type { CategoriaVendedor, TipoEstorno } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import { encerramentoAnterior, inicioDoDia } from "@/shared/domain/periodo";

/**
 * Configuração das regras de estorno.
 *
 * A alteração **nunca sobrescreve**: encerra o período vigente e abre um novo a
 * partir da data informada. É o que garante que baixar o percentual hoje não
 * reescreva o estorno apurado no ano passado — a regra é resolvida pela data do
 * cancelamento, então o período antigo continua respondendo pelos fatos antigos.
 */

export interface EntradaRegraEstorno {
  tipo: TipoEstorno;
  /** Vazio = vale para todas as categorias. */
  categoriasVenda: CategoriaVendedor[];
  /** Nulo = regra padrão da WR. */
  vendedorId: string | null;
  /** Estorna com parcelas pagas ABAIXO deste número. Zero desliga. */
  parcelaLimite: number;
  percentual: number;
  vigenteDe: Date;
  observacoes?: string | null;
}

export interface UsuarioAcao {
  id: string;
  nome: string;
}

export interface RegraListada {
  id: string;
  tipo: TipoEstorno;
  categoriasVenda: CategoriaVendedor[];
  vendedorId: string | null;
  vendedorNome: string | null;
  parcelaLimite: number;
  percentual: number;
  vigenteDe: Date;
  vigenteAte: Date | null;
  observacoes: string | null;
  vigente: boolean;
}

export async function listarRegrasEstorno(): Promise<RegraListada[]> {
  const linhas = await prisma.regraEstorno.findMany({
    include: { vendedor: { select: { nome: true } } },
    orderBy: [{ tipo: "asc" }, { vendedorId: "asc" }, { vigenteDe: "desc" }],
  });

  const hoje = inicioDoDia(new Date());

  return linhas.map((linha) => ({
    id: linha.id,
    tipo: linha.tipo,
    categoriasVenda: linha.categoriasVenda,
    vendedorId: linha.vendedorId,
    vendedorNome: linha.vendedor?.nome ?? null,
    parcelaLimite: linha.parcelaLimite,
    percentual: Number(linha.percentual),
    vigenteDe: linha.vigenteDe,
    vigenteAte: linha.vigenteAte,
    observacoes: linha.observacoes,
    vigente:
      inicioDoDia(linha.vigenteDe) <= hoje &&
      (!linha.vigenteAte || inicioDoDia(linha.vigenteAte) >= hoje),
  }));
}

/**
 * Grava uma regra, encerrando a anterior do mesmo escopo.
 *
 * "Mesmo escopo" é a tripla (tipo, categoria, vendedor): é ela que a resolução
 * usa para escolher a regra. Encerrar só o escopo exato evita que mexer no
 * percentual de um vendedor derrube a regra padrão de todo mundo.
 */
export async function salvarRegraEstorno(
  entrada: EntradaRegraEstorno,
  usuario: UsuarioAcao,
): Promise<{ id: string }> {
  const vigenteDe = inicioDoDia(entrada.vigenteDe);
  const fimDoAnterior = encerramentoAnterior(vigenteDe);

  return prisma.$transaction(async (tx) => {
    const anteriores = await tx.regraEstorno.findMany({
      where: {
        tipo: entrada.tipo,
        categoriasVenda: { equals: entrada.categoriasVenda },
        vendedorId: entrada.vendedorId,
        vigenteAte: null,
      },
      select: { id: true, percentual: true, parcelaLimite: true, vigenteDe: true },
    });

    for (const anterior of anteriores) {
      if (fimDoAnterior && inicioDoDia(anterior.vigenteDe) <= fimDoAnterior) {
        await tx.regraEstorno.update({
          where: { id: anterior.id },
          data: { vigenteAte: fimDoAnterior },
        });
      } else {
        // O período anterior começaria depois do próprio fim: durou zero dia.
        // Encerrá-lo no dia anterior criaria uma vigência invertida, então ele
        // é fechado no próprio início e some da resolução.
        await tx.regraEstorno.update({
          where: { id: anterior.id },
          data: { vigenteAte: inicioDoDia(anterior.vigenteDe) },
        });
      }
    }

    const criada = await tx.regraEstorno.create({
      data: {
        tipo: entrada.tipo,
        categoriasVenda: entrada.categoriasVenda,
        vendedorId: entrada.vendedorId,
        parcelaLimite: entrada.parcelaLimite,
        percentual: entrada.percentual,
        vigenteDe,
        observacoes: entrada.observacoes ?? null,
        usuarioId: usuario.id,
      },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        acao: "MUDANCA_PERCENTUAL",
        entidade: "RegraEstorno",
        entidadeId: criada.id,
        descricao:
          `Regra de estorno ${entrada.tipo}` +
          `${entrada.categoriasVenda.length ? ` (${entrada.categoriasVenda.join(", ")})` : ""}` +
          `${entrada.vendedorId ? " para vendedor específico" : " padrão"}: ` +
          `${entrada.percentual}% abaixo de ${entrada.parcelaLimite} parcela(s), ` +
          `a partir de ${vigenteDe.toISOString().slice(0, 10)}`,
        dadosAntes: anteriores.map((anterior) => ({
          percentual: Number(anterior.percentual),
          parcelaLimite: anterior.parcelaLimite,
        })),
        dadosDepois: {
          percentual: entrada.percentual,
          parcelaLimite: entrada.parcelaLimite,
          vigenteDe,
        },
        usuario,
      },
      tx,
    );

    return criada;
  });
}

/**
 * Encerra uma regra a partir de uma data, sem apagar.
 *
 * Desligar uma regra é abrir o fim da vigência, nunca deletar a linha: os
 * estornos já apurados apontam para ela, e o histórico precisa continuar
 * explicando por que cada valor foi cobrado.
 */
export async function encerrarRegraEstorno(
  id: string,
  em: Date,
  usuario: UsuarioAcao,
): Promise<void> {
  const atual = await prisma.regraEstorno.findUnique({ where: { id } });
  if (!atual) return;

  await prisma.$transaction(async (tx) => {
    await tx.regraEstorno.update({
      where: { id },
      data: { vigenteAte: inicioDoDia(em) },
    });

    await registrarAuditoria(
      {
        acao: "MUDANCA_PERCENTUAL",
        entidade: "RegraEstorno",
        entidadeId: id,
        descricao: `Regra de estorno ${atual.tipo} encerrada em ${inicioDoDia(em).toISOString().slice(0, 10)}`,
        dadosAntes: { vigenteAte: atual.vigenteAte },
        dadosDepois: { vigenteAte: inicioDoDia(em) },
        usuario,
      },
      tx,
    );
  });
}

/**
 * Faz as regras já cadastradas valerem desde a venda mais antiga.
 *
 * A regra é resolvida pela data do CANCELAMENTO, e um cancelamento anterior ao
 * início da vigência simplesmente não encontra regra nenhuma: a apuração
 * responde "sem regra vigente" e não cobra. Quem cadastrou a regra depois de
 * importar a base — que é o caso normal, porque a base vem primeiro — ficou com
 * a vigência começando no dia do cadastro, sem alcançar o histórico.
 *
 * A âncora é a venda mais antiga, e não o cancelamento mais antigo, porque
 * cancelamento nunca precede a venda: cobrir desde a primeira venda cobre tudo.
 *
 * **Não altera percentual nem limite de parcelas**, só a data a partir da qual
 * eles contam. E só recua: regra que já cobre a base fica como está.
 */
export async function ajustarVigenciaDasRegras(
  usuario: ContextoUsuario,
): Promise<{ ajustadas: number; inicio: Date }> {
  const inicio = await primeiraVendaDaBase();

  // Só o período ABERTO de cada regra é recuado. Período já encerrado responde
  // por um trecho do passado que alguém fechou de propósito; mexer nele
  // reescreveria a decisão antiga em vez de estender a atual.
  const atrasadas = await prisma.regraEstorno.findMany({
    where: { vigenteAte: null, vigenteDe: { gt: inicio } },
    select: { id: true, tipo: true, percentual: true, vigenteDe: true, vendedorId: true },
  });

  if (atrasadas.length === 0) return { ajustadas: 0, inicio };

  await prisma.regraEstorno.updateMany({
    where: { id: { in: atrasadas.map((regra) => regra.id) } },
    data: { vigenteDe: inicio },
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "RegraEstorno",
    descricao:
      `Vigência de ${atrasadas.length} regra(s) de estorno recuada para ` +
      `${inicio.toISOString().slice(0, 10)}, para alcançar os cancelamentos já importados. ` +
      "Nenhum percentual ou limite foi alterado.",
    dadosAntes: { regras: atrasadas },
    dadosDepois: { vigenteDe: inicio },
    usuario,
  });

  return { ajustadas: atrasadas.length, inicio };
}

/** Data da venda mais antiga importada — a âncora de "desde sempre". */
async function primeiraVendaDaBase(): Promise<Date> {
  const { _min } = await prisma.cota.aggregate({ _min: { dataVenda: true } });
  const referencia = _min.dataVenda ?? new Date();
  return new Date(
    Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), referencia.getUTCDate()),
  );
}

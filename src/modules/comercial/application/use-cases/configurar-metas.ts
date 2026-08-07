import "server-only";
import type { CategoriaVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import { encerramentoAnterior, inicioDoDia } from "@/shared/domain/periodo";

/**
 * Configuração das metas de promoção.
 *
 * Como toda regra do sistema, alterar **não sobrescreve**: encerra o período
 * vigente e abre um novo. Baixar a meta hoje não pode fazer parecer que alguém
 * já estava apto no ano passado, nem o contrário.
 */

export interface MetaListada {
  id: string;
  categoriaAlvo: CategoriaVendedor;
  volumeMinimo: number;
  vigenteDe: Date;
  vigenteAte: Date | null;
  observacoes: string | null;
  vigente: boolean;
}

export async function listarMetas(): Promise<MetaListada[]> {
  const linhas = await prisma.metaPromocao.findMany({
    orderBy: [{ categoriaAlvo: "asc" }, { vigenteDe: "desc" }],
  });

  const hoje = inicioDoDia(new Date());

  return linhas.map((linha) => ({
    id: linha.id,
    categoriaAlvo: linha.categoriaAlvo,
    volumeMinimo: Number(linha.volumeMinimo),
    vigenteDe: linha.vigenteDe,
    vigenteAte: linha.vigenteAte,
    observacoes: linha.observacoes,
    vigente:
      inicioDoDia(linha.vigenteDe) <= hoje &&
      (!linha.vigenteAte || inicioDoDia(linha.vigenteAte) >= hoje),
  }));
}

export async function salvarMeta(
  entrada: {
    categoriaAlvo: "VETERANO" | "EXPERT";
    volumeMinimo: number;
    vigenteDe: Date;
    observacoes?: string | null;
  },
  usuario: { id: string; nome: string },
): Promise<{ id: string }> {
  const vigenteDe = inicioDoDia(entrada.vigenteDe);
  const fimDoAnterior = encerramentoAnterior(vigenteDe);

  return prisma.$transaction(async (tx) => {
    const anteriores = await tx.metaPromocao.findMany({
      where: { categoriaAlvo: entrada.categoriaAlvo, vigenteAte: null },
      select: { id: true, volumeMinimo: true, vigenteDe: true },
    });

    for (const anterior of anteriores) {
      await tx.metaPromocao.update({
        where: { id: anterior.id },
        data: {
          // Período que começaria depois do próprio fim durou zero dia: fecha
          // no próprio início em vez de criar uma vigência invertida.
          vigenteAte:
            fimDoAnterior && inicioDoDia(anterior.vigenteDe) <= fimDoAnterior
              ? fimDoAnterior
              : inicioDoDia(anterior.vigenteDe),
        },
      });
    }

    const criada = await tx.metaPromocao.create({
      data: {
        categoriaAlvo: entrada.categoriaAlvo,
        volumeMinimo: entrada.volumeMinimo,
        abreDocumento: "CNPJ",
        vigenteDe,
        observacoes: entrada.observacoes ?? null,
        usuarioId: usuario.id,
      },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        acao: "MUDANCA_PERCENTUAL",
        entidade: "MetaPromocao",
        entidadeId: criada.id,
        descricao:
          `Meta de promoção a ${entrada.categoriaAlvo} passa a ser ` +
          `${entrada.volumeMinimo.toFixed(2)} a partir de ` +
          `${vigenteDe.toISOString().slice(0, 10)}`,
        dadosAntes: anteriores.map((a) => ({ volumeMinimo: Number(a.volumeMinimo) })),
        dadosDepois: { volumeMinimo: entrada.volumeMinimo, vigenteDe },
        usuario,
      },
      tx,
    );

    return criada;
  });
}

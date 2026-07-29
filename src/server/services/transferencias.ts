import "server-only";

import { prisma } from "@/lib/prisma";
import {
  encontrarRecuperacaoNaData,
  resolverCategoriaNaData,
} from "@/server/domain/regras";
import { registrarAuditoria } from "./auditoria";
import type { ContextoUsuario } from "./vendedores";

export interface EntradaTransferencia {
  cotaId: string;
  novoVendedorId: string;
  motivo: string;
}

/**
 * Transfere a cota para outro vendedor.
 *
 * A base da administradora não é alterada: a transferência cria (ou atualiza)
 * um override interno da WR, que passa a ter precedência em todo cálculo.
 * O vendedor original permanece gravado na cota e o histórico completo da
 * transferência é preservado.
 */
export async function transferirVendedor(
  entrada: EntradaTransferencia,
  usuario: ContextoUsuario,
): Promise<void> {
  const motivo = entrada.motivo.trim();
  if (!motivo) {
    throw new Error("Informe o motivo da transferência.");
  }

  const cota = await prisma.cota.findUniqueOrThrow({
    where: { id: entrada.cotaId },
    select: {
      id: true,
      contrato: true,
      grupo: true,
      cota: true,
      nomeCliente: true,
      dataVenda: true,
      vendedorEfetivoId: true,
      categoriaVenda: true,
      emRecuperacao: true,
      vendedorEfetivo: { select: { id: true, nome: true } },
      override: { select: { id: true, vendedorId: true } },
    },
  });

  if (cota.vendedorEfetivoId === entrada.novoVendedorId) {
    throw new Error("A cota já está atribuída a este vendedor.");
  }

  const novoVendedor = await prisma.vendedor.findUniqueOrThrow({
    where: { id: entrada.novoVendedorId },
    select: { id: true, nome: true, equipeId: true, gerenciaId: true },
  });

  // A categoria continua pertencendo à venda: é resolvida na DATA DA VENDA,
  // agora pelo histórico do novo vendedor — nunca pela categoria atual dele.
  let categoriaVenda = cota.categoriaVenda;
  let emRecuperacao = cota.emRecuperacao;
  let recuperacaoId: string | null | undefined;

  if (cota.dataVenda) {
    const [historico, recuperacoes] = await Promise.all([
      prisma.vendedorCategoriaHistorico.findMany({
        where: { vendedorId: novoVendedor.id },
        select: { categoria: true, vigenteDe: true, vigenteAte: true },
      }),
      prisma.vendedorRecuperacao.findMany({
        where: { vendedorId: novoVendedor.id },
        select: { id: true, dataInicio: true, dataFim: true },
      }),
    ]);

    categoriaVenda = resolverCategoriaNaData(historico, cota.dataVenda);
    const recuperacao = encontrarRecuperacaoNaData(recuperacoes, cota.dataVenda);
    if (recuperacao) {
      // A marcação de recuperação só pode ser acrescentada, nunca removida.
      emRecuperacao = true;
      recuperacaoId = recuperacao.id;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (cota.override) {
      await tx.cotaVendedorOverride.update({
        where: { id: cota.override.id },
        data: { vendedorId: novoVendedor.id, motivo, criadoPorId: usuario.id },
      });
    } else {
      await tx.cotaVendedorOverride.create({
        data: {
          cotaId: cota.id,
          vendedorId: novoVendedor.id,
          motivo,
          criadoPorId: usuario.id,
        },
      });
    }

    await tx.cotaVendedorOverrideHistorico.create({
      data: {
        cotaId: cota.id,
        vendedorAnteriorId: cota.vendedorEfetivo?.id ?? null,
        vendedorNovoId: novoVendedor.id,
        vendedorAnteriorNome: cota.vendedorEfetivo?.nome ?? null,
        vendedorNovoNome: novoVendedor.nome,
        motivo,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
      },
    });

    await tx.cota.update({
      where: { id: cota.id },
      data: {
        vendedorEfetivoId: novoVendedor.id,
        origemVendedor: "OVERRIDE_WR",
        equipeId: novoVendedor.equipeId,
        gerenciaId: novoVendedor.gerenciaId,
        categoriaVenda,
        emRecuperacao,
        ...(recuperacaoId ? { recuperacaoId, recuperacaoFixadaEm: new Date() } : {}),
      },
    });

    // Lançamentos de comissão já importados passam a apontar para o vendedor
    // correto, mantendo os snapshots da venda coerentes com a cota.
    await tx.comissaoRegistro.updateMany({
      where: { cotaId: cota.id },
      data: {
        vendedorId: novoVendedor.id,
        origemVendedor: "OVERRIDE_WR",
        equipeId: novoVendedor.equipeId,
        gerenciaId: novoVendedor.gerenciaId,
        categoriaVenda,
        emRecuperacao,
      },
    });
  });

  await registrarAuditoria({
    acao: "TRANSFERENCIA_VENDEDOR",
    entidade: "Cota",
    entidadeId: cota.id,
    descricao: `Cota ${cota.grupo}/${cota.cota} (contrato ${cota.contrato}) transferida de ${cota.vendedorEfetivo?.nome ?? "sem vendedor"} para ${novoVendedor.nome}`,
    dadosAntes: {
      vendedorId: cota.vendedorEfetivo?.id ?? null,
      vendedorNome: cota.vendedorEfetivo?.nome ?? null,
      categoriaVenda: cota.categoriaVenda,
      emRecuperacao: cota.emRecuperacao,
    },
    dadosDepois: {
      vendedorId: novoVendedor.id,
      vendedorNome: novoVendedor.nome,
      categoriaVenda,
      emRecuperacao,
      motivo,
    },
    usuario,
  });
}

/** Remove o override e devolve a cota ao vendedor informado pela administradora. */
export async function reverterTransferencia(
  cotaId: string,
  motivo: string,
  usuario: ContextoUsuario,
): Promise<void> {
  const cota = await prisma.cota.findUniqueOrThrow({
    where: { id: cotaId },
    select: {
      id: true,
      grupo: true,
      cota: true,
      contrato: true,
      vendedorAdmId: true,
      vendedorEfetivo: { select: { id: true, nome: true } },
      override: { select: { id: true } },
      vendedorAdm: { select: { id: true, nome: true, equipeId: true, gerenciaId: true } },
    },
  });

  if (!cota.override) {
    throw new Error("Esta cota não possui transferência interna para reverter.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.cotaVendedorOverride.delete({ where: { id: cota.override!.id } });

    await tx.cotaVendedorOverrideHistorico.create({
      data: {
        cotaId: cota.id,
        vendedorAnteriorId: cota.vendedorEfetivo?.id ?? null,
        vendedorNovoId: cota.vendedorAdm?.id ?? null,
        vendedorAnteriorNome: cota.vendedorEfetivo?.nome ?? null,
        vendedorNovoNome: cota.vendedorAdm?.nome ?? null,
        motivo: `Reversão da transferência: ${motivo}`,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
      },
    });

    await tx.cota.update({
      where: { id: cota.id },
      data: {
        vendedorEfetivoId: cota.vendedorAdmId,
        origemVendedor: cota.vendedorAdmId ? "ADMINISTRADORA" : "NAO_IDENTIFICADO",
        equipeId: cota.vendedorAdm?.equipeId ?? null,
        gerenciaId: cota.vendedorAdm?.gerenciaId ?? null,
      },
    });
  });

  await registrarAuditoria({
    acao: "TRANSFERENCIA_VENDEDOR",
    entidade: "Cota",
    entidadeId: cota.id,
    descricao: `Transferência da cota ${cota.grupo}/${cota.cota} revertida para o vendedor da administradora`,
    dadosDepois: { motivo },
    usuario,
  });
}

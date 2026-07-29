"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const STATUS = ["ATIVO", "INATIVO"] as const;

// ---------------------------------------------------------------------------
// Gerências
// ---------------------------------------------------------------------------

const esquemaGerencia = z.object({
  nome: z.string().trim().min(2, "Informe o nome da gerência"),
  status: z.enum(STATUS).default("ATIVO"),
});

export async function acaoCriarGerencia(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("gerencias", "criar");

  const parsed = esquemaGerencia.safeParse({
    nome: formData.get("nome"),
    status: formData.get("status") ?? "ATIVO",
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const existente = await prisma.gerencia.findUnique({ where: { nome: parsed.data.nome } });
  if (existente) return { erro: "Já existe uma gerência com esse nome." };

  const gerencia = await prisma.gerencia.create({ data: parsed.data });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Gerencia",
    entidadeId: gerencia.id,
    descricao: `Gerência ${gerencia.nome} cadastrada`,
    dadosDepois: gerencia,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/gerencias");
  return { sucesso: "Gerência cadastrada." };
}

export async function acaoAtualizarGerencia(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("gerencias", "editar");

  const id = String(formData.get("id") ?? "");
  const parsed = esquemaGerencia.safeParse({
    nome: formData.get("nome"),
    status: formData.get("status") ?? "ATIVO",
  });

  if (!id) return { erro: "Gerência não informada." };
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const antes = await prisma.gerencia.findUnique({ where: { id } });
  if (!antes) return { erro: "Gerência não encontrada." };

  await prisma.gerencia.update({ where: { id }, data: parsed.data });

  await registrarAuditoria({
    acao: antes.status !== parsed.data.status && parsed.data.status === "INATIVO"
      ? "INATIVACAO"
      : "ATUALIZACAO",
    entidade: "Gerencia",
    entidadeId: id,
    descricao: `Gerência ${parsed.data.nome} atualizada`,
    dadosAntes: antes,
    dadosDepois: parsed.data,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/gerencias");
  return { sucesso: "Gerência atualizada." };
}

// ---------------------------------------------------------------------------
// Equipes
// ---------------------------------------------------------------------------

const esquemaEquipe = z.object({
  nome: z.string().trim().min(2, "Informe o nome da equipe"),
  gerenciaId: z.string().min(1, "Selecione a gerência"),
  status: z.enum(STATUS).default("ATIVO"),
});

export async function acaoCriarEquipe(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("equipes", "criar");

  const parsed = esquemaEquipe.safeParse({
    nome: formData.get("nome"),
    gerenciaId: formData.get("gerenciaId"),
    status: formData.get("status") ?? "ATIVO",
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const existente = await prisma.equipe.findUnique({
    where: { gerenciaId_nome: { gerenciaId: parsed.data.gerenciaId, nome: parsed.data.nome } },
  });
  if (existente) return { erro: "Essa gerência já possui uma equipe com esse nome." };

  const equipe = await prisma.equipe.create({ data: parsed.data });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Equipe",
    entidadeId: equipe.id,
    descricao: `Equipe ${equipe.nome} cadastrada`,
    dadosDepois: equipe,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/equipes");
  return { sucesso: "Equipe cadastrada." };
}

export async function acaoAtualizarEquipe(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("equipes", "editar");

  const id = String(formData.get("id") ?? "");
  const parsed = esquemaEquipe.safeParse({
    nome: formData.get("nome"),
    gerenciaId: formData.get("gerenciaId"),
    status: formData.get("status") ?? "ATIVO",
  });

  if (!id) return { erro: "Equipe não informada." };
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const antes = await prisma.equipe.findUnique({ where: { id } });
  if (!antes) return { erro: "Equipe não encontrada." };

  await prisma.equipe.update({ where: { id }, data: parsed.data });

  await registrarAuditoria({
    acao: antes.gerenciaId !== parsed.data.gerenciaId ? "MUDANCA_GERENCIA" : "ATUALIZACAO",
    entidade: "Equipe",
    entidadeId: id,
    descricao: `Equipe ${parsed.data.nome} atualizada`,
    dadosAntes: antes,
    dadosDepois: parsed.data,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/equipes");
  return { sucesso: "Equipe atualizada." };
}

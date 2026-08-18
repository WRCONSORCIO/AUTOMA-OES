"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const PERFIS = [
  "ADMINISTRADOR",
  "GERENTE",
  "SUPERVISOR",
  "FINANCEIRO",
  "RH",
  "ATENDENTE",
] as const;

const esquema = z.object({
  nome: z.string().trim().min(3, "Informe o nome"),
  email: z.string().trim().email("Informe um e-mail válido"),
  senha: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
  perfil: z.enum(PERFIS),
  gerenciaId: z.string().optional(),
  equipeId: z.string().optional(),
});

export async function acaoCriarUsuario(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("usuarios", "criar");

  const parsed = esquema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const email = parsed.data.email.toLowerCase();

  if (parsed.data.perfil === "GERENTE" && !parsed.data.gerenciaId) {
    return { erro: "Um gerente precisa estar vinculado a uma gerência." };
  }
  if (parsed.data.perfil === "SUPERVISOR" && !parsed.data.equipeId) {
    return { erro: "Um supervisor precisa estar vinculado a uma equipe." };
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) return { erro: "Já existe um usuário com esse e-mail." };

  const usuario = await prisma.usuario.create({
    data: {
      nome: parsed.data.nome,
      email,
      senhaHash: await bcrypt.hash(parsed.data.senha, 12),
      perfil: parsed.data.perfil,
      gerenciaId: parsed.data.gerenciaId || null,
      equipeId: parsed.data.equipeId || null,
    },
    select: { id: true, nome: true, email: true, perfil: true },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Usuario",
    entidadeId: usuario.id,
    descricao: `Usuário ${usuario.nome} (${usuario.perfil}) criado`,
    dadosDepois: usuario,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/usuarios");
  return { sucesso: "Usuário criado." };
}

export async function acaoAlternarUsuario(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("usuarios", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Usuário não informado." };
  if (id === sessao.id) return { erro: "Você não pode inativar o próprio acesso." };

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) return { erro: "Usuário não encontrado." };

  const atualizado = await prisma.usuario.update({
    where: { id },
    data: { ativo: !usuario.ativo },
  });

  await registrarAuditoria({
    acao: atualizado.ativo ? "REATIVACAO" : "INATIVACAO",
    entidade: "Usuario",
    entidadeId: id,
    descricao: `Usuário ${usuario.nome} ${atualizado.ativo ? "reativado" : "inativado"}`,
    dadosAntes: { ativo: usuario.ativo },
    dadosDepois: { ativo: atualizado.ativo },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/usuarios");
  return { sucesso: atualizado.ativo ? "Usuário reativado." : "Usuário inativado." };
}

export async function acaoRedefinirSenha(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("usuarios", "editar");

  const id = String(formData.get("id") ?? "");
  const senha = String(formData.get("senha") ?? "");

  if (!id) return { erro: "Usuário não informado." };
  if (senha.length < 8) return { erro: "A senha deve ter ao menos 8 caracteres." };

  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  if (!usuario) return { erro: "Usuário não encontrado." };

  await prisma.usuario.update({
    where: { id },
    data: { senhaHash: await bcrypt.hash(senha, 12) },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Usuario",
    entidadeId: id,
    descricao: `Senha de ${usuario.nome} redefinida`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/usuarios");
  return { sucesso: "Senha redefinida." };
}

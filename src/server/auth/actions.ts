"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import { criarSessao, destruirSessao, lerSessao } from "./session";

const esquemaLogin = z.object({
  email: z.string().email("Informe um e-mail válido"),
  senha: z.string().min(1, "Informe a senha"),
});

export interface EstadoLogin {
  erro?: string;
}

export async function entrar(
  _estadoAnterior: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const parsed = esquemaLogin.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    senha: String(formData.get("senha") ?? ""),
  });

  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const usuario = await prisma.usuario.findUnique({
    where: { email: parsed.data.email },
  });

  // Mensagem genérica: não revela se o e-mail existe.
  const credenciaisInvalidas = { erro: "E-mail ou senha inválidos" };

  if (!usuario) {
    await bcrypt.compare(parsed.data.senha, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    return credenciaisInvalidas;
  }

  const senhaConfere = await bcrypt.compare(parsed.data.senha, usuario.senhaHash);
  if (!senhaConfere) {
    await registrarAuditoria({
      acao: "LOGIN_FALHA",
      entidade: "Usuario",
      entidadeId: usuario.id,
      descricao: `Tentativa de login com senha incorreta para ${usuario.email}`,
    });
    return credenciaisInvalidas;
  }

  if (!usuario.ativo) {
    return { erro: "Usuário inativo. Procure o administrador do sistema." };
  }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { ultimoLoginEm: new Date() },
  });

  await criarSessao({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    gerenciaId: usuario.gerenciaId,
    equipeId: usuario.equipeId,
  });

  await registrarAuditoria({
    acao: "LOGIN",
    entidade: "Usuario",
    entidadeId: usuario.id,
    descricao: `${usuario.nome} entrou no sistema`,
    usuario: { id: usuario.id, nome: usuario.nome },
  });

  redirect("/");
}

export async function sair(): Promise<void> {
  const sessao = await lerSessao();
  if (sessao) {
    await registrarAuditoria({
      acao: "LOGOUT",
      entidade: "Usuario",
      entidadeId: sessao.id,
      descricao: `${sessao.nome} saiu do sistema`,
      usuario: { id: sessao.id, nome: sessao.nome },
    });
  }
  await destruirSessao();
  redirect("/login");
}

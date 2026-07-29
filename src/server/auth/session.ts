import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { PerfilUsuario } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { escopoDoUsuario, podeAcessar, type Acao, type Modulo } from "./rbac";

export const COOKIE_SESSAO = "wr_sessao";

export interface SessaoUsuario {
  id: string;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  gerenciaId: string | null;
  equipeId: string | null;
}

function chaveSecreta(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function criarSessao(usuario: SessaoUsuario): Promise<void> {
  const maxAge = env().AUTH_SESSION_MAX_AGE_SECONDS;
  const token = await new SignJWT({
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    gerenciaId: usuario.gerenciaId,
    equipeId: usuario.equipeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuario.id)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(chaveSecreta());

  const store = await cookies();
  store.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function destruirSessao(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_SESSAO);
}

export async function lerSessao(): Promise<SessaoUsuario | null> {
  const store = await cookies();
  const token = store.get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, chaveSecreta());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      nome: String(payload.nome ?? ""),
      email: String(payload.email ?? ""),
      perfil: payload.perfil as PerfilUsuario,
      gerenciaId: (payload.gerenciaId as string | null) ?? null,
      equipeId: (payload.equipeId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Sessão validada contra o banco. Usuário inativado perde acesso imediatamente,
 * sem depender da expiração do token.
 */
export async function exigirSessao(): Promise<SessaoUsuario> {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const usuario = await prisma.usuario.findUnique({
    where: { id: sessao.id },
    select: {
      id: true,
      nome: true,
      email: true,
      perfil: true,
      ativo: true,
      gerenciaId: true,
      equipeId: true,
    },
  });

  if (!usuario || !usuario.ativo) {
    await destruirSessao();
    redirect("/login?erro=sessao");
  }

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    gerenciaId: usuario.gerenciaId,
    equipeId: usuario.equipeId,
  };
}

export async function exigirPermissao(
  modulo: Modulo,
  acao: Acao = "ver",
): Promise<SessaoUsuario> {
  const sessao = await exigirSessao();
  if (!podeAcessar(sessao.perfil, modulo, acao)) {
    redirect("/sem-permissao");
  }
  return sessao;
}

export async function sessaoComEscopo() {
  const sessao = await exigirSessao();
  return { sessao, escopo: escopoDoUsuario(sessao) };
}

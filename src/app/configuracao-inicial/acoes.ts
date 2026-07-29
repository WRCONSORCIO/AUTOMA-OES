"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { criarSessao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";
import { criarEstruturaInicial, sistemaInstalado } from "@/server/services/instalacao";

export interface EstadoAcao {
  erro?: string;
}

const esquema = z
  .object({
    nome: z.string().trim().min(3, "Informe seu nome"),
    email: z.string().trim().email("Informe um e-mail válido"),
    senha: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: "As senhas não conferem",
    path: ["confirmacao"],
  });

/**
 * Cria o primeiro administrador e a estrutura inicial do sistema.
 *
 * Só funciona enquanto não existe nenhum usuário. A verificação é refeita
 * dentro da transação, com bloqueio da tabela, para que duas requisições
 * simultâneas não consigam criar dois administradores.
 */
export async function acaoConfiguracaoInicial(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  if (await sistemaInstalado()) redirect("/login");

  const parsed = esquema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const email = parsed.data.email.toLowerCase();
  let jaInstalado = false;

  try {
    const criado = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Usuario" IN SHARE ROW EXCLUSIVE MODE`;

      if (await sistemaInstalado(tx)) {
        throw new Error("JA_INSTALADO");
      }

      const usuario = await tx.usuario.create({
        data: {
          nome: parsed.data.nome,
          email,
          senhaHash: await bcrypt.hash(parsed.data.senha, 12),
          perfil: "ADMINISTRADOR",
        },
        select: { id: true, nome: true, email: true, perfil: true },
      });

      await criarEstruturaInicial(tx);
      return usuario;
    });

    await criarSessao({
      id: criado.id,
      nome: criado.nome,
      email: criado.email,
      perfil: criado.perfil,
      gerenciaId: null,
      equipeId: null,
    });

    await registrarAuditoria({
      acao: "CRIACAO",
      entidade: "Usuario",
      entidadeId: criado.id,
      descricao: `Configuração inicial concluída por ${criado.nome}`,
      dadosDepois: { email: criado.email, perfil: criado.perfil },
      usuario: { id: criado.id, nome: criado.nome },
    });
  } catch (erro) {
    if (erro instanceof Error && erro.message === "JA_INSTALADO") {
      jaInstalado = true;
    } else {
      return {
        erro: erro instanceof Error ? erro.message : "Falha ao concluir a configuração inicial.",
      };
    }
  }

  // `redirect` lança internamente: fica fora do try para não ser capturado.
  redirect(jaInstalado ? "/login" : "/");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const ROTA = "/atendimento/aparelhos";

/**
 * A chave é o identificador estável do aparelho: fluxos e integrações apontam
 * para ela. Nome e ícone podem mudar quando o administrador quiser; a chave não
 * muda depois de criada, para não quebrar fluxo já configurado.
 */
const chaveSchema = z
  .string()
  .trim()
  .min(2, "Informe a chave")
  .regex(/^[a-z0-9_]+$/, "A chave aceita apenas letras minúsculas, números e _");

const esquema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  icone: z.string().trim().max(8).optional(),
  status: z.enum(["ATIVO", "INATIVO"]).default("ATIVO"),
  fluxoId: z.string().trim().optional(),
  instrucoes: z.string().trim().optional(),
});

export async function acaoCriarAparelho(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("aparelhos", "criar");

  const dados = Object.fromEntries(formData);
  const chave = chaveSchema.safeParse(dados.chave);
  if (!chave.success) return { erro: chave.error.issues[0]?.message ?? "Chave inválida" };

  const parsed = esquema.safeParse(dados);
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const existente = await prisma.aparelho.findUnique({ where: { chave: chave.data } });
  if (existente) return { erro: "Já existe um aparelho com essa chave." };

  const ultimo = await prisma.aparelho.findFirst({ orderBy: { ordem: "desc" } });

  const aparelho = await prisma.aparelho.create({
    data: {
      chave: chave.data,
      nome: parsed.data.nome,
      icone: parsed.data.icone || null,
      status: parsed.data.status,
      fluxoId: parsed.data.fluxoId || null,
      instrucoes: parsed.data.instrucoes || null,
      ordem: (ultimo?.ordem ?? -1) + 1,
    },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Aparelho",
    entidadeId: aparelho.id,
    descricao: `Aparelho ${aparelho.nome} criado`,
    dadosDepois: { chave: aparelho.chave, nome: aparelho.nome },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Aparelho criado." };
}

export async function acaoAtualizarAparelho(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("aparelhos", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Aparelho não informado." };

  const parsed = esquema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const antes = await prisma.aparelho.findUnique({ where: { id } });
  if (!antes) return { erro: "Aparelho não encontrado." };

  const depois = await prisma.aparelho.update({
    where: { id },
    data: {
      nome: parsed.data.nome,
      icone: parsed.data.icone || null,
      status: parsed.data.status,
      fluxoId: parsed.data.fluxoId || null,
      instrucoes: parsed.data.instrucoes || null,
    },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Aparelho",
    entidadeId: id,
    descricao: `Aparelho ${depois.nome} atualizado`,
    dadosAntes: { nome: antes.nome, status: antes.status, fluxoId: antes.fluxoId },
    dadosDepois: { nome: depois.nome, status: depois.status, fluxoId: depois.fluxoId },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Aparelho atualizado." };
}

export async function acaoAlternarAparelho(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("aparelhos", "editar");

  const id = String(formData.get("id") ?? "");
  const aparelho = await prisma.aparelho.findUnique({ where: { id } });
  if (!aparelho) return { erro: "Aparelho não encontrado." };

  const atualizado = await prisma.aparelho.update({
    where: { id },
    data: { status: aparelho.status === "ATIVO" ? "INATIVO" : "ATIVO" },
  });

  await registrarAuditoria({
    acao: atualizado.status === "ATIVO" ? "REATIVACAO" : "INATIVACAO",
    entidade: "Aparelho",
    entidadeId: id,
    descricao: `Aparelho ${aparelho.nome} ${atualizado.status === "ATIVO" ? "ativado" : "desativado"}`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: atualizado.status === "ATIVO" ? "Aparelho ativado." : "Aparelho desativado." };
}

export async function acaoExcluirAparelho(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("aparelhos", "excluir");

  const id = String(formData.get("id") ?? "");
  const aparelho = await prisma.aparelho.findUnique({
    where: { id },
    include: { _count: { select: { opcoes: true } } },
  });
  if (!aparelho) return { erro: "Aparelho não encontrado." };

  if (aparelho._count.opcoes > 0) {
    return { erro: "Este aparelho é usado por um fluxo. Remova a opção do fluxo antes de excluir." };
  }

  await prisma.aparelho.delete({ where: { id } });

  await registrarAuditoria({
    acao: "INATIVACAO",
    entidade: "Aparelho",
    entidadeId: id,
    descricao: `Aparelho ${aparelho.nome} excluído`,
    dadosAntes: { chave: aparelho.chave, nome: aparelho.nome },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Aparelho excluído." };
}

export async function acaoMoverAparelho(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("aparelhos", "editar");

  const id = String(formData.get("id") ?? "");
  const direcao = String(formData.get("direcao") ?? "");
  if (direcao !== "cima" && direcao !== "baixo") return { erro: "Direção inválida." };

  const aparelhos = await prisma.aparelho.findMany({
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
  });
  const indice = aparelhos.findIndex((aparelho) => aparelho.id === id);
  if (indice < 0) return { erro: "Aparelho não encontrado." };

  const destino = direcao === "cima" ? indice - 1 : indice + 1;
  if (destino < 0 || destino >= aparelhos.length) return {};

  const reordenados = [...aparelhos];
  [reordenados[indice], reordenados[destino]] = [reordenados[destino]!, reordenados[indice]!];

  await prisma.$transaction(
    reordenados.map((aparelho, posicao) =>
      prisma.aparelho.update({ where: { id: aparelho.id }, data: { ordem: posicao } }),
    ),
  );

  revalidatePath(ROTA);
  return {};
}

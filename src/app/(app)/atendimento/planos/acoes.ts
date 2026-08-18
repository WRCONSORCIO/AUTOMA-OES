"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const ROTA = "/atendimento/planos";

/**
 * Preço chega como texto do formulário, em formato brasileiro. Vira `Decimal`
 * antes de tocar o banco: dinheiro nunca trafega como float neste sistema.
 */
const precoSchema = z
  .string()
  .trim()
  .min(1, "Informe o preço")
  .transform((valor) => valor.replace(/\./g, "").replace(",", "."))
  .refine((valor) => /^\d+(\.\d{1,2})?$/.test(valor), "Preço inválido")
  .transform((valor) => new Prisma.Decimal(valor));

const esquema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do plano"),
  descricao: z.string().trim().optional(),
  duracaoDias: z.coerce.number().int().positive("A duração deve ser maior que zero"),
  preco: precoSchema,
  moeda: z.string().trim().length(3).default("BRL"),
  status: z.enum(["ATIVO", "INATIVO"]).default("ATIVO"),
  ordem: z.coerce.number().int().min(0).default(0),
  destaque: z.coerce.boolean().default(false),
  textoCliente: z.string().trim().optional(),
});

export async function acaoCriarPlano(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("planos", "criar");

  const parsed = esquema.safeParse(entrada(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const plano = await prisma.plano.create({
    data: {
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      duracaoDias: parsed.data.duracaoDias,
      preco: parsed.data.preco,
      moeda: parsed.data.moeda.toUpperCase(),
      status: parsed.data.status,
      ordem: parsed.data.ordem,
      destaque: parsed.data.destaque,
      textoCliente: parsed.data.textoCliente || null,
    },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Plano",
    entidadeId: plano.id,
    descricao: `Plano ${plano.nome} criado`,
    dadosDepois: { nome: plano.nome, preco: plano.preco.toString(), duracaoDias: plano.duracaoDias },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Plano criado." };
}

export async function acaoAtualizarPlano(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("planos", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Plano não informado." };

  const parsed = esquema.safeParse(entrada(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const antes = await prisma.plano.findUnique({ where: { id } });
  if (!antes) return { erro: "Plano não encontrado." };

  const depois = await prisma.plano.update({
    where: { id },
    data: {
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      duracaoDias: parsed.data.duracaoDias,
      preco: parsed.data.preco,
      moeda: parsed.data.moeda.toUpperCase(),
      status: parsed.data.status,
      ordem: parsed.data.ordem,
      destaque: parsed.data.destaque,
      textoCliente: parsed.data.textoCliente || null,
    },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Plano",
    entidadeId: id,
    descricao: `Plano ${depois.nome} atualizado`,
    dadosAntes: { nome: antes.nome, preco: antes.preco.toString(), status: antes.status },
    dadosDepois: { nome: depois.nome, preco: depois.preco.toString(), status: depois.status },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Plano atualizado." };
}

export async function acaoAlternarPlano(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("planos", "editar");

  const id = String(formData.get("id") ?? "");
  const plano = await prisma.plano.findUnique({ where: { id } });
  if (!plano) return { erro: "Plano não encontrado." };

  const atualizado = await prisma.plano.update({
    where: { id },
    data: { status: plano.status === "ATIVO" ? "INATIVO" : "ATIVO" },
  });

  await registrarAuditoria({
    acao: atualizado.status === "ATIVO" ? "REATIVACAO" : "INATIVACAO",
    entidade: "Plano",
    entidadeId: id,
    descricao: `Plano ${plano.nome} ${atualizado.status === "ATIVO" ? "ativado" : "desativado"}`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return {
    sucesso: atualizado.status === "ATIVO" ? "Plano ativado." : "Plano desativado.",
  };
}

/**
 * Exclusão só é permitida enquanto o plano nunca foi vendido.
 *
 * Apagar plano com pedido apagaria o histórico da compra junto — quando há
 * pedido, o caminho é desativar, que tira o plano do bot e preserva o passado.
 */
export async function acaoExcluirPlano(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("planos", "excluir");

  const id = String(formData.get("id") ?? "");
  const plano = await prisma.plano.findUnique({
    where: { id },
    include: { _count: { select: { pedidos: true, opcoes: true } } },
  });
  if (!plano) return { erro: "Plano não encontrado." };

  if (plano._count.pedidos > 0) {
    return {
      erro: "Este plano já tem pedidos. Desative-o em vez de excluir, para preservar o histórico.",
    };
  }
  if (plano._count.opcoes > 0) {
    return { erro: "Este plano é usado por um fluxo. Remova a opção do fluxo antes de excluir." };
  }

  await prisma.plano.delete({ where: { id } });

  await registrarAuditoria({
    acao: "INATIVACAO",
    entidade: "Plano",
    entidadeId: id,
    descricao: `Plano ${plano.nome} excluído`,
    dadosAntes: { nome: plano.nome, preco: plano.preco.toString() },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Plano excluído." };
}

/** Move o plano uma posição para cima ou para baixo na lista mostrada ao cliente. */
export async function acaoMoverPlano(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("planos", "editar");

  const id = String(formData.get("id") ?? "");
  const direcao = String(formData.get("direcao") ?? "");
  if (direcao !== "cima" && direcao !== "baixo") return { erro: "Direção inválida." };

  const planos = await prisma.plano.findMany({ orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  const indice = planos.findIndex((plano) => plano.id === id);
  if (indice < 0) return { erro: "Plano não encontrado." };

  const destino = direcao === "cima" ? indice - 1 : indice + 1;
  if (destino < 0 || destino >= planos.length) return {};

  const reordenados = [...planos];
  [reordenados[indice], reordenados[destino]] = [reordenados[destino]!, reordenados[indice]!];

  await prisma.$transaction(
    reordenados.map((plano, posicao) =>
      prisma.plano.update({ where: { id: plano.id }, data: { ordem: posicao } }),
    ),
  );

  revalidatePath(ROTA);
  return {};
}

function entrada(formData: FormData): Record<string, unknown> {
  const dados = Object.fromEntries(formData) as Record<string, unknown>;
  // Checkbox ausente no POST significa desmarcado; `z.coerce.boolean` leria
  // `undefined` como erro de tipo em vez de `false`.
  dados.destaque = formData.get("destaque") === "on" || formData.get("destaque") === "true";
  return dados;
}

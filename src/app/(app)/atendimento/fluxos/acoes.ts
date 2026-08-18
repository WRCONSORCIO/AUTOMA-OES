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

const TIPOS_ETAPA = [
  "TEXT",
  "MENU",
  "BUTTONS",
  "LIST",
  "INPUT",
  "PAYMENT",
  "PAYMENT_STATUS",
  "DEVICE_SELECTION",
  "HUMAN_HANDOFF",
  "END",
] as const;

const TIPOS_FLUXO = ["PRINCIPAL", "NOVA_CONTRATACAO", "RENOVACAO", "APARELHO", "AUXILIAR"] as const;

const chaveSchema = z
  .string()
  .trim()
  .min(2, "Informe a chave")
  .regex(/^[a-z0-9_]+$/, "A chave aceita apenas letras minúsculas, números e _");

function revalidar(fluxoId?: string): void {
  revalidatePath("/atendimento/fluxos");
  if (fluxoId) revalidatePath(`/atendimento/fluxos/${fluxoId}`);
}

// ---------------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------------

export async function acaoCriarFluxo(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("fluxos", "criar");
  const dados = Object.fromEntries(formData);

  const parsed = z
    .object({
      chave: chaveSchema,
      nome: z.string().trim().min(2, "Informe o nome"),
      descricao: z.string().trim().optional(),
      tipo: z.enum(TIPOS_FLUXO),
    })
    .safeParse(dados);

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const existente = await prisma.fluxo.findUnique({ where: { chave: parsed.data.chave } });
  if (existente) return { erro: "Já existe um fluxo com essa chave." };

  // Só um fluxo principal ativo: dois seriam duas portas de entrada, e a
  // conversa nova cairia em qualquer uma delas.
  if (parsed.data.tipo === "PRINCIPAL") {
    const principal = await prisma.fluxo.findFirst({
      where: { tipo: "PRINCIPAL", status: "ATIVO" },
    });
    if (principal) {
      return {
        erro: `Já existe um fluxo principal ativo (${principal.nome}). Desative-o antes de criar outro.`,
      };
    }
  }

  const fluxo = await prisma.fluxo.create({
    data: {
      chave: parsed.data.chave,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      tipo: parsed.data.tipo,
    },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "Fluxo",
    entidadeId: fluxo.id,
    descricao: `Fluxo ${fluxo.nome} criado`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar();
  return { sucesso: "Fluxo criado. Agora cadastre as etapas." };
}

export async function acaoAtualizarFluxo(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("fluxos", "editar");
  const dados = Object.fromEntries(formData);

  const parsed = z
    .object({
      id: z.string().min(1),
      nome: z.string().trim().min(2, "Informe o nome"),
      descricao: z.string().trim().optional(),
      tipo: z.enum(TIPOS_FLUXO),
      status: z.enum(["ATIVO", "INATIVO"]),
      etapaInicialId: z.string().optional(),
    })
    .safeParse(dados);

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  if (parsed.data.tipo === "PRINCIPAL" && parsed.data.status === "ATIVO") {
    const outro = await prisma.fluxo.findFirst({
      where: { tipo: "PRINCIPAL", status: "ATIVO", id: { not: parsed.data.id } },
    });
    if (outro) return { erro: `Já existe um fluxo principal ativo (${outro.nome}).` };
  }

  await prisma.fluxo.update({
    where: { id: parsed.data.id },
    data: {
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      tipo: parsed.data.tipo,
      status: parsed.data.status,
      etapaInicialId: parsed.data.etapaInicialId || null,
    },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Fluxo",
    entidadeId: parsed.data.id,
    descricao: `Fluxo ${parsed.data.nome} atualizado`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar(parsed.data.id);
  return { sucesso: "Fluxo atualizado." };
}

export async function acaoExcluirFluxo(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("fluxos", "excluir");
  const id = String(formData.get("id") ?? "");

  const fluxo = await prisma.fluxo.findUnique({
    where: { id },
    include: { _count: { select: { conversas: true, aparelhos: true } } },
  });
  if (!fluxo) return { erro: "Fluxo não encontrado." };

  if (fluxo._count.conversas > 0) {
    return { erro: "Há conversas neste fluxo. Desative-o em vez de excluir." };
  }
  if (fluxo._count.aparelhos > 0) {
    return { erro: "Há aparelhos apontando para este fluxo. Desvincule-os antes." };
  }

  // A etapa inicial precisa sair primeiro: o fluxo aponta para ela e ela para
  // o fluxo, e o banco recusa apagar os dois de uma vez.
  await prisma.fluxo.update({ where: { id }, data: { etapaInicialId: null } });
  await prisma.fluxo.delete({ where: { id } });

  await registrarAuditoria({
    acao: "INATIVACAO",
    entidade: "Fluxo",
    entidadeId: id,
    descricao: `Fluxo ${fluxo.nome} excluído`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar();
  return { sucesso: "Fluxo excluído." };
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

const etapaSchema = z.object({
  fluxoId: z.string().min(1),
  chave: chaveSchema,
  nome: z.string().trim().min(2, "Informe o nome da etapa"),
  tipo: z.enum(TIPOS_ETAPA),
  mensagem: z.string().trim().min(1, "Escreva a mensagem enviada nesta etapa"),
  proximaEtapaId: z.string().optional(),
  proximoFluxoId: z.string().optional(),
  titulo: z.string().trim().optional(),
  rotuloBotao: z.string().trim().optional(),
  variavel: z.string().trim().optional(),
  fontePlanos: z.string().optional(),
});

function montarConfig(dados: z.infer<typeof etapaSchema>): Prisma.InputJsonValue | undefined {
  const config: Record<string, string> = {};
  if (dados.fontePlanos === "on") config.fonte = "planos";
  if (dados.titulo) config.titulo = dados.titulo;
  if (dados.rotuloBotao) config.rotuloBotao = dados.rotuloBotao;
  if (dados.variavel) config.variavel = dados.variavel;

  return Object.keys(config).length > 0 ? config : undefined;
}

export async function acaoCriarEtapa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("fluxos", "criar");

  const parsed = etapaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const duplicada = await prisma.etapaFluxo.findUnique({
    where: { fluxoId_chave: { fluxoId: parsed.data.fluxoId, chave: parsed.data.chave } },
  });
  if (duplicada) return { erro: "Já existe uma etapa com essa chave neste fluxo." };

  const ultima = await prisma.etapaFluxo.findFirst({
    where: { fluxoId: parsed.data.fluxoId },
    orderBy: { ordem: "desc" },
  });

  const etapa = await prisma.etapaFluxo.create({
    data: {
      fluxoId: parsed.data.fluxoId,
      chave: parsed.data.chave,
      nome: parsed.data.nome,
      tipo: parsed.data.tipo,
      mensagem: parsed.data.mensagem,
      ordem: (ultima?.ordem ?? -1) + 1,
      proximaEtapaId: parsed.data.proximaEtapaId || null,
      proximoFluxoId: parsed.data.proximoFluxoId || null,
      config: montarConfig(parsed.data),
    },
  });

  // Primeira etapa do fluxo vira automaticamente a inicial: fluxo sem etapa
  // inicial não roda, e esquecer de marcar é o erro mais fácil de cometer.
  const fluxo = await prisma.fluxo.findUnique({ where: { id: parsed.data.fluxoId } });
  if (fluxo && !fluxo.etapaInicialId) {
    await prisma.fluxo.update({
      where: { id: fluxo.id },
      data: { etapaInicialId: etapa.id },
    });
  }

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "EtapaFluxo",
    entidadeId: etapa.id,
    descricao: `Etapa ${etapa.nome} criada no fluxo ${fluxo?.nome ?? ""}`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar(parsed.data.fluxoId);
  return { sucesso: "Etapa criada." };
}

export async function acaoAtualizarEtapa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("fluxos", "editar");

  const dados = Object.fromEntries(formData);
  const parsed = etapaSchema.extend({ id: z.string().min(1) }).safeParse(dados);
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  if (parsed.data.proximaEtapaId === parsed.data.id) {
    return { erro: "Uma etapa não pode apontar para ela mesma." };
  }

  await prisma.etapaFluxo.update({
    where: { id: parsed.data.id },
    data: {
      nome: parsed.data.nome,
      tipo: parsed.data.tipo,
      mensagem: parsed.data.mensagem,
      proximaEtapaId: parsed.data.proximaEtapaId || null,
      proximoFluxoId: parsed.data.proximoFluxoId || null,
      config: montarConfig(parsed.data) ?? Prisma.JsonNull,
    },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "EtapaFluxo",
    entidadeId: parsed.data.id,
    descricao: `Etapa ${parsed.data.nome} atualizada`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidar(parsed.data.fluxoId);
  return { sucesso: "Etapa atualizada." };
}

export async function acaoExcluirEtapa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("fluxos", "excluir");

  const id = String(formData.get("id") ?? "");
  const fluxoId = String(formData.get("fluxoId") ?? "");

  const etapa = await prisma.etapaFluxo.findUnique({
    where: { id },
    include: { _count: { select: { conversas: true } }, fluxo: true },
  });
  if (!etapa) return { erro: "Etapa não encontrada." };

  if (etapa._count.conversas > 0) {
    return { erro: "Há conversas paradas nesta etapa. Mova-as antes de excluir." };
  }

  // Quem apontava para ela passa a não apontar para lugar nenhum — melhor do
  // que apontar para uma etapa que não existe mais.
  await prisma.etapaFluxo.updateMany({
    where: { proximaEtapaId: id },
    data: { proximaEtapaId: null },
  });
  await prisma.opcaoEtapaFluxo.updateMany({
    where: { proximaEtapaId: id },
    data: { proximaEtapaId: null },
  });

  if (etapa.fluxo.etapaInicialId === id) {
    await prisma.fluxo.update({ where: { id: etapa.fluxoId }, data: { etapaInicialId: null } });
  }

  await prisma.etapaFluxo.delete({ where: { id } });

  revalidar(fluxoId || etapa.fluxoId);
  return { sucesso: "Etapa excluída." };
}

export async function acaoMoverEtapa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("fluxos", "editar");

  const id = String(formData.get("id") ?? "");
  const fluxoId = String(formData.get("fluxoId") ?? "");
  const direcao = String(formData.get("direcao") ?? "");

  const etapas = await prisma.etapaFluxo.findMany({
    where: { fluxoId },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
  });

  const indice = etapas.findIndex((etapa) => etapa.id === id);
  if (indice < 0) return { erro: "Etapa não encontrada." };

  const destino = direcao === "cima" ? indice - 1 : indice + 1;
  if (destino < 0 || destino >= etapas.length) return {};

  const reordenadas = [...etapas];
  [reordenadas[indice], reordenadas[destino]] = [reordenadas[destino]!, reordenadas[indice]!];

  await prisma.$transaction(
    reordenadas.map((etapa, posicao) =>
      prisma.etapaFluxo.update({ where: { id: etapa.id }, data: { ordem: posicao } }),
    ),
  );

  revalidar(fluxoId);
  return {};
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

export async function acaoCriarOpcao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("fluxos", "criar");

  const parsed = z
    .object({
      etapaId: z.string().min(1),
      fluxoId: z.string().min(1),
      rotulo: z.string().trim().min(1, "Informe o rótulo"),
      valor: z.string().trim().min(1, "Informe o valor"),
      proximaEtapaId: z.string().optional(),
      proximoFluxoId: z.string().optional(),
      planoId: z.string().optional(),
      aparelhoId: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const ultima = await prisma.opcaoEtapaFluxo.findFirst({
    where: { etapaId: parsed.data.etapaId },
    orderBy: { ordem: "desc" },
  });

  await prisma.opcaoEtapaFluxo.create({
    data: {
      etapaId: parsed.data.etapaId,
      rotulo: parsed.data.rotulo,
      valor: parsed.data.valor,
      ordem: (ultima?.ordem ?? -1) + 1,
      proximaEtapaId: parsed.data.proximaEtapaId || null,
      proximoFluxoId: parsed.data.proximoFluxoId || null,
      planoId: parsed.data.planoId || null,
      aparelhoId: parsed.data.aparelhoId || null,
    },
  });

  revalidar(parsed.data.fluxoId);
  return { sucesso: "Opção adicionada." };
}

export async function acaoAtualizarOpcao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("fluxos", "editar");

  const parsed = z
    .object({
      id: z.string().min(1),
      fluxoId: z.string().min(1),
      rotulo: z.string().trim().min(1, "Informe o rótulo"),
      valor: z.string().trim().min(1, "Informe o valor"),
      proximaEtapaId: z.string().optional(),
      proximoFluxoId: z.string().optional(),
      ativo: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  await prisma.opcaoEtapaFluxo.update({
    where: { id: parsed.data.id },
    data: {
      rotulo: parsed.data.rotulo,
      valor: parsed.data.valor,
      proximaEtapaId: parsed.data.proximaEtapaId || null,
      proximoFluxoId: parsed.data.proximoFluxoId || null,
      ativo: parsed.data.ativo === "on",
    },
  });

  revalidar(parsed.data.fluxoId);
  return { sucesso: "Opção atualizada." };
}

export async function acaoExcluirOpcao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("fluxos", "excluir");

  const id = String(formData.get("id") ?? "");
  const fluxoId = String(formData.get("fluxoId") ?? "");

  await prisma.opcaoEtapaFluxo.delete({ where: { id } });

  revalidar(fluxoId);
  return { sucesso: "Opção removida." };
}

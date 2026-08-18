"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";
import { cifrar } from "@/server/atendimento/servicos/segredos";
import { resolverProvedorWhatsApp } from "@/server/atendimento/whatsapp/fabrica";
import {
  CHAVE_CONFIG_PAGAMENTO,
  lerConfiguracaoPagamento,
  obterProvedorPagamento,
} from "@/server/atendimento/pagamentos/fabrica";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const ROTA = "/atendimento/configuracoes";

/**
 * Credenciais nunca voltam para o navegador em texto claro, e campo vazio
 * significa "mantenha o que já está gravado" — é o que permite editar a URL da
 * API sem ter de redigitar a chave secreta.
 */
function segredoOuManter(valor: unknown): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) return undefined;
  return cifrar(texto);
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export async function acaoSalvarWhatsApp(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("configAtendimento", "editar");
  const dados = Object.fromEntries(formData);

  const parsed = z
    .object({
      id: z.string().optional(),
      nome: z.string().trim().min(2, "Informe um nome para a instância"),
      provedor: z.enum(["EVOLUTION", "CLOUD_API"]),
      apiUrl: z.string().trim().url("Informe a URL da API"),
      instancia: z.string().trim().optional(),
      status: z.enum(["ATIVO", "INATIVO"]),
    })
    .safeParse(dados);

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const credenciais = {
    apiKeyCifrada: segredoOuManter(dados.apiKey),
    webhookTokenCifrado: segredoOuManter(dados.webhookToken),
  };

  const comum = {
    nome: parsed.data.nome,
    provedor: parsed.data.provedor,
    apiUrl: parsed.data.apiUrl,
    instancia: parsed.data.instancia || null,
    status: parsed.data.status,
    ...credenciais,
  };

  if (parsed.data.id) {
    await prisma.instanciaWhatsApp.update({ where: { id: parsed.data.id }, data: comum });
  } else {
    const primeira = (await prisma.instanciaWhatsApp.count()) === 0;
    await prisma.instanciaWhatsApp.create({ data: { ...comum, padrao: primeira } });
  }

  await registrarAuditoria({
    acao: parsed.data.id ? "ATUALIZACAO" : "CRIACAO",
    entidade: "InstanciaWhatsApp",
    entidadeId: parsed.data.id ?? null,
    // Nunca registrar a credencial — nem parte dela.
    descricao: `Instância de WhatsApp "${parsed.data.nome}" ${parsed.data.id ? "atualizada" : "cadastrada"}`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Configuração do WhatsApp salva." };
}

export async function acaoTestarWhatsApp(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  await exigirPermissao("configAtendimento", "ver");
  const id = String(formData.get("id") ?? "") || null;

  const { provider, simulado } = await resolverProvedorWhatsApp(id);

  if (simulado) {
    return {
      erro: "Nenhuma credencial válida encontrada: o sistema está em modo simulação e não envia mensagens.",
    };
  }

  try {
    const estado = await provider.estadoConexao();
    if (!estado.conectado) {
      return { erro: `${provider.nome}: ${estado.detalhe ?? "não conectado"}` };
    }

    await prisma.instanciaWhatsApp.updateMany({
      where: id ? { id } : { status: "ATIVO" },
      data: { conectadoEm: new Date(), ultimoErro: null },
    });

    return { sucesso: `${provider.nome} conectado. ${estado.detalhe ?? ""}`.trim() };
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : "falha desconhecida";

    await prisma.instanciaWhatsApp.updateMany({
      where: id ? { id } : { status: "ATIVO" },
      data: { ultimoErro: detalhe.slice(0, 300) },
    });

    return { erro: detalhe };
  }
}

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------

export async function acaoSalvarPagamento(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("configAtendimento", "editar");
  const dados = Object.fromEntries(formData);

  const parsed = z
    .object({
      provedor: z.enum(["STRIPE", "MANUAL"]),
      ambiente: z.enum(["TEST", "LIVE"]),
      publishableKey: z.string().trim().optional(),
    })
    .safeParse(dados);

  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const atual = (await lerConfiguracaoPagamento()) ?? {};

  const valor = {
    provedor: parsed.data.provedor,
    ambiente: parsed.data.ambiente,
    publishableKey: parsed.data.publishableKey || atual.publishableKey || null,
    secretKeyCifrada: segredoOuManter(dados.secretKey) ?? atual.secretKeyCifrada ?? null,
    webhookSecretCifrado:
      segredoOuManter(dados.webhookSecret) ?? atual.webhookSecretCifrado ?? null,
  };

  if (parsed.data.provedor === "STRIPE" && !valor.secretKeyCifrada) {
    return { erro: "Informe a chave secreta para ativar a Stripe." };
  }

  await prisma.configuracaoSistema.upsert({
    where: { chave: CHAVE_CONFIG_PAGAMENTO },
    create: {
      chave: CHAVE_CONFIG_PAGAMENTO,
      valor: valor as Prisma.InputJsonValue,
      descricao: "Gateway de pagamento do atendimento",
    },
    update: { valor: valor as Prisma.InputJsonValue },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "ConfiguracaoSistema",
    descricao: `Gateway de pagamento configurado: ${parsed.data.provedor} (${parsed.data.ambiente})`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Configuração de pagamento salva." };
}

export async function acaoTestarPagamento(): Promise<EstadoAcao> {
  await exigirPermissao("configAtendimento", "ver");

  const provedor = await obterProvedorPagamento();
  const resultado = await provedor.testarConexao();

  return resultado.ok ? { sucesso: resultado.detalhe } : { erro: resultado.detalhe };
}

// ---------------------------------------------------------------------------
// Horário de atendimento
// ---------------------------------------------------------------------------

const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, "Use o formato HH:MM");

export async function acaoSalvarHorarios(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("configAtendimento", "editar");

  for (let diaSemana = 0; diaSemana <= 6; diaSemana += 1) {
    const abertura = String(formData.get(`abertura_${diaSemana}`) ?? "");
    const fechamento = String(formData.get(`fechamento_${diaSemana}`) ?? "");
    const fechado = formData.get(`fechado_${diaSemana}`) === "on";

    if (!fechado) {
      const validaAbertura = horaSchema.safeParse(abertura);
      const validaFechamento = horaSchema.safeParse(fechamento);

      if (!validaAbertura.success || !validaFechamento.success) {
        return { erro: `Horário inválido no dia ${diaSemana}. Use HH:MM.` };
      }
      if (abertura >= fechamento) {
        return { erro: `No dia ${diaSemana}, a abertura precisa ser antes do fechamento.` };
      }
    }

    await prisma.horarioAtendimento.upsert({
      where: { diaSemana },
      create: { diaSemana, abertura: abertura || "08:00", fechamento: fechamento || "18:00", fechado },
      update: { abertura: abertura || "08:00", fechamento: fechamento || "18:00", fechado },
    });
  }

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "HorarioAtendimento",
    descricao: "Horário de atendimento humano atualizado",
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(ROTA);
  return { sucesso: "Horários salvos." };
}

"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import {
  assumirConversa,
  devolverAoBot,
  encerrarConversaManualmente,
  responderComoAtendente,
} from "@/server/atendimento/servicos/atendimento-humano";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

function revalidar(conversaId: string): void {
  revalidatePath("/atendimento/conversas");
  revalidatePath(`/atendimento/conversas/${conversaId}`);
}

export async function acaoAssumirConversa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("conversas", "editar");
  const id = String(formData.get("id") ?? "");

  const resultado = await assumirConversa(id, sessao);
  revalidar(id);

  return resultado.ok ? { sucesso: "Atendimento assumido." } : { erro: resultado.erro };
}

export async function acaoDevolverAoBot(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("conversas", "editar");
  const id = String(formData.get("id") ?? "");

  const resultado = await devolverAoBot(id, sessao);
  revalidar(id);

  return resultado.ok
    ? { sucesso: "Conversa devolvida ao bot, na etapa em que estava." }
    : { erro: resultado.erro };
}

export async function acaoResponder(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("conversas", "criar");
  const id = String(formData.get("id") ?? "");
  const texto = String(formData.get("texto") ?? "");

  const resultado = await responderComoAtendente(id, texto, sessao);
  revalidar(id);

  return resultado.ok ? { sucesso: "Mensagem enviada." } : { erro: resultado.erro };
}

export async function acaoEncerrarConversa(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("conversas", "editar");
  const id = String(formData.get("id") ?? "");

  const resultado = await encerrarConversaManualmente(id, sessao);
  revalidar(id);

  return resultado.ok ? { sucesso: "Conversa encerrada." } : { erro: resultado.erro };
}

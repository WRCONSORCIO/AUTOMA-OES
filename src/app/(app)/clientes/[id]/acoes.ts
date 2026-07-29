"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { reverterTransferencia, transferirVendedor } from "@/server/services/transferencias";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const esquemaTransferencia = z.object({
  cotaId: z.string().min(1),
  novoVendedorId: z.string().min(1, "Selecione o novo vendedor"),
  motivo: z.string().trim().min(3, "Descreva o motivo da transferência"),
});

export async function acaoTransferirVendedor(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("transferencias", "editar");

  const parsed = esquemaTransferencia.safeParse({
    cotaId: formData.get("cotaId"),
    novoVendedorId: formData.get("novoVendedorId"),
    motivo: formData.get("motivo"),
  });

  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    await transferirVendedor(parsed.data, { id: sessao.id, nome: sessao.nome });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao transferir a cota." };
  }

  revalidatePath(`/clientes/${parsed.data.cotaId}`);
  revalidatePath("/clientes");
  return { sucesso: "Transferência registrada. Todo cálculo passa a usar o vendedor WR." };
}

export async function acaoReverterTransferencia(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("transferencias", "editar");

  const cotaId = String(formData.get("cotaId") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!cotaId) return { erro: "Cota não informada." };
  if (motivo.length < 3) return { erro: "Descreva o motivo da reversão." };

  try {
    await reverterTransferencia(cotaId, motivo, { id: sessao.id, nome: sessao.nome });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao reverter a transferência." };
  }

  revalidatePath(`/clientes/${cotaId}`);
  revalidatePath("/clientes");
  return { sucesso: "Transferência revertida. A cota voltou ao vendedor da administradora." };
}

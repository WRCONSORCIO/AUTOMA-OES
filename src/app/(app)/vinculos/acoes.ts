"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { separarDocumento, vincularDocumentos } from "@/server/services/pessoas";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

function revalidar(): void {
  revalidatePath("/vinculos");
  revalidatePath("/vendedores");
  revalidatePath("/pendencias");
  revalidatePath("/");
}

export async function acaoVincular(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const vendedorIds = formData.getAll("vendedorId").map(String).filter(Boolean);
  const pessoaDestinoId = String(formData.get("pessoaDestinoId") ?? "") || undefined;
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (vendedorIds.length < 2 && !pessoaDestinoId) {
    return { erro: "Selecione ao menos dois cadastros para vincular." };
  }

  try {
    const resultado = await vincularDocumentos(
      { vendedorIds, pessoaDestinoId, motivo: motivo || "Mesmo vendedor, documentos diferentes" },
      { id: sessao.id, nome: sessao.nome },
    );

    revalidar();
    return {
      sucesso: `${resultado.documentosVinculados} cadastro(s) agora pertencem à mesma pessoa. Categoria e recuperação passam a valer para todos eles.`,
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao vincular os cadastros." };
  }
}

export async function acaoSeparar(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const vendedorId = String(formData.get("vendedorId") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!vendedorId) return { erro: "Cadastro não informado." };
  if (motivo.length < 3) return { erro: "Descreva o motivo da separação." };

  try {
    await separarDocumento({ vendedorId, motivo }, { id: sessao.id, nome: sessao.nome });
    revalidar();
    return {
      sucesso:
        "Cadastro separado. Ele começa sem categoria — registre uma para que as vendas dele voltem a gerar comissão.",
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao separar o cadastro." };
  }
}

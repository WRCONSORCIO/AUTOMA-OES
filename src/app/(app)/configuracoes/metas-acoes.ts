"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { parseValorBr } from "@/lib/normalize";
import { salvarMeta } from "@/modules/comercial/application/use-cases/configurar-metas";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

export async function acaoSalvarMeta(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const categoriaAlvo = String(formData.get("categoriaAlvo") ?? "").trim();
  const volume = parseValorBr(String(formData.get("volumeMinimo") ?? ""));
  const bruto = String(formData.get("vigenteDe") ?? "").trim();
  const observacoes = String(formData.get("observacoes") ?? "").trim() || null;

  if (categoriaAlvo !== "VETERANO" && categoriaAlvo !== "EXPERT") {
    return { erro: "Degrau inválido." };
  }
  if (volume === null || volume <= 0) {
    return { erro: "Informe o volume da meta." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
    return { erro: "Informe a data de início da vigência." };
  }

  await salvarMeta(
    {
      categoriaAlvo,
      volumeMinimo: volume,
      vigenteDe: new Date(`${bruto}T00:00:00.000Z`),
      observacoes,
    },
    { id: sessao.id, nome: sessao.nome },
  );

  revalidatePath("/configuracoes");
  revalidatePath("/vendedores");
  revalidatePath("/");

  return {
    sucesso:
      `Meta de ${categoriaAlvo} passa a ser ` +
      `${volume.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ` +
      "a partir da data informada. Promoções já registradas não mudam.",
  };
}

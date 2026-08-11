"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { promoverPessoa } from "@/modules/comercial/application/use-cases/promover-pessoa";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

function lerData(bruto: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return null;
  const data = new Date(`${bruto}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Promove a pessoa ao próximo degrau.
 *
 * Exige permissão de **edição** em vendedores: promover cria cadastro, abre
 * vigência e muda por onde as vendas novas entram. Não é leitura.
 */
export async function acaoPromover(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const pessoaId = String(formData.get("pessoaId") ?? "").trim();
  const categoriaAlvo = String(formData.get("categoriaAlvo") ?? "").trim();
  const cpfCnpjNovo = String(formData.get("cpfCnpjNovo") ?? "").trim();
  const vigenteDe = lerData(String(formData.get("vigenteDe") ?? ""));
  const motivo = String(formData.get("motivo") ?? "").trim() || null;
  const nomeNovo = String(formData.get("nomeNovo") ?? "").trim() || null;

  if (!pessoaId) return { erro: "Pessoa não informada." };
  if (categoriaAlvo !== "VETERANO" && categoriaAlvo !== "EXPERT") {
    return { erro: "Degrau inválido." };
  }
  if (!cpfCnpjNovo) return { erro: "Informe o CNPJ do documento que vai operar na nova categoria." };
  if (!vigenteDe) return { erro: "Informe a data em que a promoção passa a valer." };

  const resultado = await promoverPessoa(
    { pessoaId, categoriaAlvo, cpfCnpjNovo, nomeNovo, vigenteDe, motivo },
    { id: sessao.id, nome: sessao.nome },
  );

  if (!resultado.ok) return { erro: resultado.erro.mensagem };

  revalidatePath("/vendedores");
  revalidatePath(`/vendedores/${resultado.valor.vendedorNovoId}`);

  return { sucesso: `Promoção registrada. ${resultado.valor.resumo}` };
}

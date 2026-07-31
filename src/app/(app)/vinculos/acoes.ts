"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import {
  separarDocumento,
  vincularDocumentos,
  vincularSugestoesEmLote,
} from "@/server/services/pessoas";
import type { Confianca } from "@/server/domain/vinculo-nomes";
import { recalcularComissoes } from "@/server/services/recalculo";
import { formatarNumero } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

function revalidar(): void {
  revalidatePath("/vinculos");
  revalidatePath("/vendedores");
  revalidatePath("/pendencias");
  revalidatePath("/comissoes");
  revalidatePath("/comissoes-equipe");
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

const CONFIANCAS: Confianca[] = ["CERTO", "ALTA", "MEDIA", "BAIXA"];

/**
 * Aplica de uma vez todas as sugestões de um nível de confiança para cima.
 *
 * Conferir centenas de cadastros um a um é inviável, e a maior parte das
 * sugestões é óbvia. Cada vínculo continua entrando na auditoria e no histórico
 * da pessoa, e pode ser desfeito documento por documento.
 */
export async function acaoVincularEmLote(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const ateBruto = String(formData.get("ate") ?? "ALTA") as Confianca;
  if (!CONFIANCAS.includes(ateBruto)) return { erro: "Nível de confiança inválido." };

  const confiancas = CONFIANCAS.slice(0, CONFIANCAS.indexOf(ateBruto) + 1);

  try {
    const resultado = await vincularSugestoesEmLote(
      { confiancas, motivo: "Vínculo em lote a partir das sugestões" },
      { id: sessao.id, nome: sessao.nome },
    );

    revalidar();

    if (resultado.gruposVinculados === 0) {
      return { erro: "Nenhuma sugestão nesse nível de confiança para aplicar." };
    }

    // O CNPJ recém-vinculado herda a categoria do CPF, então as vendas dele
    // deixam de estar bloqueadas. Recalcular aqui evita uma segunda viagem.
    const recalculo = await recalcularComissoes({ id: sessao.id, nome: sessao.nome });

    return {
      sucesso:
        `${formatarNumero(resultado.gruposVinculados)} vendedor(es) reunidos, somando ` +
        `${formatarNumero(resultado.documentosVinculados)} cadastro(s). ` +
        `Recálculo em seguida: ${formatarNumero(recalculo.cotasComCategoriaPreenchida)} venda(s) ` +
        `ganharam categoria e ${formatarNumero(recalculo.lancamentosAtualizados)} lançamento(s) foram atualizados.` +
        (resultado.gruposIgnorados > 0
          ? ` ${formatarNumero(resultado.gruposIgnorados)} sugestão(ões) de confiança menor ficaram para conferência.`
          : ""),
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao vincular em lote." };
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

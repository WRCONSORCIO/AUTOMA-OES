"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { registrarAuditoria } from "@/server/services/auditoria";
import {
  alterarAlocacao,
  alterarCategoria,
  criarVendedor,
  cancelarRecuperacao,
  registrarRecuperacao,
} from "@/server/services/vendedores";
import { recalcularComissoes } from "@/server/services/recalculo";
import { formatarMoeda, formatarNumero } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const CATEGORIAS = ["INICIANTE", "VETERANO", "EXPERT"] as const;
const SITUACOES = ["ATIVO", "INATIVO", "AFASTADO", "DESLIGADO"] as const;

const esquemaVendedor = z.object({
  nome: z.string().trim().min(3, "Informe o nome do vendedor"),
  cpfCnpj: z.string().trim().min(11, "Informe o CPF/CNPJ"),
  equipeId: z.string().optional(),
  gerenciaId: z.string().optional(),
  categoriaAtual: z.enum(CATEGORIAS),
  dataEntradaWr: z.string().optional(),
  situacao: z.enum(SITUACOES).optional(),
  observacoes: z.string().optional(),
});

export async function acaoCriarVendedor(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "criar");

  const parsed = esquemaVendedor.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    await criarVendedor(
      {
        nome: parsed.data.nome,
        cpfCnpj: parsed.data.cpfCnpj,
        equipeId: parsed.data.equipeId || null,
        gerenciaId: parsed.data.gerenciaId || null,
        categoriaAtual: parsed.data.categoriaAtual,
        dataEntradaWr: parsed.data.dataEntradaWr ? parseDataBr(parsed.data.dataEntradaWr) : null,
        situacao: parsed.data.situacao,
        observacoes: parsed.data.observacoes || null,
      },
      { id: sessao.id, nome: sessao.nome },
    );
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao cadastrar o vendedor." };
  }

  revalidatePath("/vendedores");
  return { sucesso: "Vendedor cadastrado." };
}

export async function acaoAtualizarVendedor(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Vendedor não informado." };

  const nome = String(formData.get("nome") ?? "").trim();
  const situacao = String(formData.get("situacao") ?? "ATIVO") as (typeof SITUACOES)[number];
  const observacoes = String(formData.get("observacoes") ?? "").trim() || null;
  const dataEntradaWr = parseDataBr(String(formData.get("dataEntradaWr") ?? ""));

  if (nome.length < 3) return { erro: "Informe o nome do vendedor." };

  const antes = await prisma.vendedor.findUnique({
    where: { id },
    select: { nome: true, situacao: true, observacoes: true, dataEntradaWr: true },
  });
  if (!antes) return { erro: "Vendedor não encontrado." };

  await prisma.vendedor.update({
    where: { id },
    data: { nome, situacao, observacoes, dataEntradaWr },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Vendedor",
    entidadeId: id,
    descricao: `Cadastro de ${nome} atualizado`,
    dadosAntes: antes,
    dadosDepois: { nome, situacao, observacoes, dataEntradaWr },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath(`/vendedores/${id}`);
  revalidatePath("/vendedores");
  return { sucesso: "Cadastro atualizado." };
}

export async function acaoAlterarCategoria(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const id = String(formData.get("id") ?? "");
  const categoria = String(formData.get("categoria") ?? "") as (typeof CATEGORIAS)[number];
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));
  const motivo = String(formData.get("motivo") ?? "").trim() || null;

  if (!id) return { erro: "Vendedor não informado." };
  if (!CATEGORIAS.includes(categoria)) return { erro: "Categoria inválida." };
  if (!vigenteDe) return { erro: "Informe a data de início da nova categoria." };

  const usuario = { id: sessao.id, nome: sessao.nome };

  try {
    await alterarCategoria(id, categoria, vigenteDe, motivo, usuario);

    // Sem este passo o cadastro fica certo e as vendas continuam "sem
    // categoria de venda", que é a condição para a comissão nem ser tentada.
    // Escopado ao documento: só as vendas dele mudaram de situação.
    const resumo = await recalcularComissoes(usuario, { vendedorId: id });

    revalidatePath(`/vendedores/${id}`);
    revalidatePath("/vendedores");
    revalidatePath("/pendencias");
    revalidatePath("/comissoes-equipe");

    const partes = [
      `${formatarNumero(resumo.cotasComCategoriaPreenchida)} venda(s) passaram a ter categoria`,
    ];
    if (resumo.linhasComissaoEquipe > 0) {
      partes.push(
        `${formatarNumero(resumo.linhasComissaoEquipe)} linha(s) de comissão apuradas ` +
          `(${formatarMoeda(resumo.valorComissaoEquipePrevisto)} previstos)`,
      );
    }

    return {
      sucesso:
        `Categoria alterada. ${partes.join(", ")}. ` +
        "As vendas anteriores continuam sendo calculadas com a categoria vigente na data de cada venda.",
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao alterar a categoria." };
  }
}

export async function acaoAlterarAlocacao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const id = String(formData.get("id") ?? "");
  const equipeId = String(formData.get("equipeId") ?? "") || null;
  const gerenciaId = String(formData.get("gerenciaId") ?? "") || null;
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? "")) ?? new Date();
  const motivo = String(formData.get("motivo") ?? "").trim() || null;

  if (!id) return { erro: "Vendedor não informado." };

  try {
    await alterarAlocacao(id, equipeId, gerenciaId, vigenteDe, motivo, {
      id: sessao.id,
      nome: sessao.nome,
    });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao alterar a alocação." };
  }

  revalidatePath(`/vendedores/${id}`);
  return { sucesso: "Equipe e gerência atualizadas." };
}

export async function acaoRegistrarRecuperacao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "editar");

  const id = String(formData.get("id") ?? "");
  const dataInicio = parseDataBr(String(formData.get("dataInicio") ?? ""));
  const dataFim = parseDataBr(String(formData.get("dataFim") ?? ""));
  const motivo = String(formData.get("motivo") ?? "").trim() || null;

  if (!id) return { erro: "Vendedor não informado." };
  if (!dataInicio || !dataFim) return { erro: "Informe as datas de início e fim." };

  try {
    const resultado = await registrarRecuperacao(id, dataInicio, dataFim, motivo, {
      id: sessao.id,
      nome: sessao.nome,
    });

    revalidatePath(`/vendedores/${id}`);
    return {
      sucesso: `Recuperação registrada. ${resultado.cotasMarcadas} venda(s) do período foram marcadas permanentemente.`,
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao registrar a recuperação." };
  }
}

/**
 * Cancela um registro de recuperação feito por engano.
 *
 * Exige permissão de EXCLUIR, e não de editar: desfaz um fato e mexe em
 * estorno já calculado. Quem pode corrigir um cadastro não necessariamente
 * pode desfazer uma cobrança.
 */
export async function acaoCancelarRecuperacao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("vendedores", "excluir");

  const vendedorId = String(formData.get("vendedorId") ?? "");
  const recuperacaoId = String(formData.get("recuperacaoId") ?? "");
  const motivo = String(formData.get("motivoCancelamento") ?? "").trim();

  if (!recuperacaoId) return { erro: "Recuperação não informada." };
  if (!motivo) return { erro: "Informe o motivo do cancelamento — ele fica na auditoria." };

  try {
    const resultado = await cancelarRecuperacao(recuperacaoId, motivo, {
      id: sessao.id,
      nome: sessao.nome,
    });

    revalidatePath(`/vendedores/${vendedorId}`);

    const partes = [`${resultado.cotasDesmarcadas} venda(s) desmarcada(s)`];
    if (resultado.cotasRemarcadas > 0) {
      partes.push(
        `${resultado.cotasRemarcadas} continua(m) marcada(s) por outro período`,
      );
    }
    if (resultado.estornosRemovidos > 0) {
      partes.push(`${resultado.estornosRemovidos} estorno(s) removido(s)`);
    }
    if (resultado.estornosAtualizados > 0) {
      partes.push(`${resultado.estornosAtualizados} estorno(s) recalculado(s)`);
    }
    if (resultado.valorLiberado !== 0) {
      partes.push(
        `${resultado.valorLiberado.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })} deixaram de ser cobrados`,
      );
    }

    return { sucesso: `Recuperação cancelada. ${partes.join(", ")}.` };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao cancelar a recuperação." };
  }
}

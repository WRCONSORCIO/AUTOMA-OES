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
  registrarRecuperacao,
} from "@/server/services/vendedores";

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

  try {
    await alterarCategoria(id, categoria, vigenteDe, motivo, {
      id: sessao.id,
      nome: sessao.nome,
    });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao alterar a categoria." };
  }

  revalidatePath(`/vendedores/${id}`);
  return {
    sucesso:
      "Categoria alterada. As vendas anteriores continuam sendo calculadas com a categoria vigente na data de cada venda.",
  };
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

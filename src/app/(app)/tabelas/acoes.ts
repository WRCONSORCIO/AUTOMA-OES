"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseDataBr, parseValorBr } from "@/lib/normalize";
import { registrarAuditoria } from "@/server/services/auditoria";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const CATEGORIAS = ["INICIANTE", "VETERANO", "EXPERT"] as const;

/**
 * Cria uma nova versão da tabela de comissão. Tabelas anteriores não são
 * alteradas: o cálculo já realizado permanece com os percentuais da época.
 */
export async function acaoCriarTabela(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const nome = String(formData.get("nome") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "") as (typeof CATEGORIAS)[number];
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));

  if (nome.length < 2) return { erro: "Informe o nome da tabela." };
  if (!CATEGORIAS.includes(categoria)) return { erro: "Categoria inválida." };
  if (!vigenteDe) return { erro: "Informe a data de início de vigência." };

  const faixas: { parcela: number; percentual: string }[] = [];
  for (let parcela = 1; parcela <= 12; parcela += 1) {
    const bruto = String(formData.get(`percentual_${parcela}`) ?? "").trim();
    if (!bruto) continue;
    const valor = parseValorBr(bruto);
    if (valor === null || valor < 0) {
      return { erro: `Percentual inválido na parcela ${parcela}.` };
    }
    if (valor > 0) faixas.push({ parcela, percentual: valor.toFixed(4) });
  }

  if (faixas.length === 0) {
    return { erro: "Informe ao menos um percentual. Parcelas sem percentual não geram comissão." };
  }

  const criada = await prisma.$transaction(async (tx) => {
    // Encerra a vigência da tabela anterior da mesma categoria no dia anterior.
    const anterior = await tx.tabelaComissao.findFirst({
      where: { categoria, ativo: true, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

    if (anterior) {
      const fim = new Date(vigenteDe);
      fim.setUTCDate(fim.getUTCDate() - 1);
      await tx.tabelaComissao.update({ where: { id: anterior.id }, data: { vigenteAte: fim } });
    }

    return tx.tabelaComissao.create({
      data: {
        nome,
        categoria,
        vigenteDe,
        faixas: {
          create: faixas.map((faixa) => ({
            parcela: faixa.parcela,
            percentual: new Prisma.Decimal(faixa.percentual),
          })),
        },
      },
      include: { faixas: true },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissao",
    entidadeId: criada.id,
    descricao: `Nova tabela de comissão "${nome}" para ${categoria} vigente a partir de ${vigenteDe.toISOString().slice(0, 10)}`,
    dadosDepois: { nome, categoria, vigenteDe, faixas },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return {
    sucesso:
      "Tabela criada. Os cálculos já realizados mantêm os percentuais que estavam vigentes na época.",
  };
}

const esquemaFlex = z.object({
  nome: z.string().trim().min(2, "Informe o nome da modalidade"),
  percentual: z.string().min(1, "Informe o percentual"),
});

export async function acaoCriarModalidadeFlex(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const parsed = esquemaFlex.safeParse({
    nome: formData.get("nome"),
    percentual: formData.get("percentual"),
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const percentual = parseValorBr(parsed.data.percentual);
  if (percentual === null || percentual <= 0 || percentual > 100) {
    return { erro: "O percentual deve estar entre 0 e 100." };
  }

  const existente = await prisma.modalidadeFlex.findUnique({ where: { nome: parsed.data.nome } });
  if (existente) return { erro: "Já existe uma modalidade com esse nome." };

  const modalidade = await prisma.modalidadeFlex.create({
    data: { nome: parsed.data.nome, percentual: new Prisma.Decimal(percentual.toFixed(4)) },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "ModalidadeFlex",
    entidadeId: modalidade.id,
    descricao: `Modalidade Flex "${modalidade.nome}" criada com ${percentual}%`,
    dadosDepois: { nome: modalidade.nome, percentual },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return { sucesso: "Modalidade cadastrada." };
}

export async function acaoAlternarModalidade(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Modalidade não informada." };

  const modalidade = await prisma.modalidadeFlex.findUnique({ where: { id } });
  if (!modalidade) return { erro: "Modalidade não encontrada." };

  const atualizada = await prisma.modalidadeFlex.update({
    where: { id },
    data: { ativo: !modalidade.ativo },
  });

  await registrarAuditoria({
    acao: atualizada.ativo ? "REATIVACAO" : "INATIVACAO",
    entidade: "ModalidadeFlex",
    entidadeId: id,
    descricao: `Modalidade Flex "${modalidade.nome}" ${atualizada.ativo ? "reativada" : "inativada"}`,
    dadosAntes: { ativo: modalidade.ativo },
    dadosDepois: { ativo: atualizada.ativo },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return { sucesso: atualizada.ativo ? "Modalidade reativada." : "Modalidade inativada." };
}

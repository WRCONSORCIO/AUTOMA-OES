"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { parseValorBr } from "@/lib/normalize";
import {
  ajustarVigenciaDasRegras,
  encerrarRegraEstorno,
  salvarRegraEstorno,
} from "@/modules/apuracao/application/use-cases/configurar-regra-estorno";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

/**
 * Percentual e limite chegam como texto do formulário, no formato brasileiro.
 * A validação é rígida de propósito: é dinheiro que sai do bolso de alguém, e
 * um campo mal preenchido não pode virar regra vigente.
 */
const esquema = z.object({
  tipo: z.enum(["CANCELAMENTO", "RECUPERACAO"]),
  categoriasVenda: z.array(z.enum(["INICIANTE", "VETERANO", "EXPERT"])),
  vendedorId: z.string().min(1).nullable(),
  parcelaLimite: z.number().int().min(0).max(200),
  percentual: z.number().min(0).max(100),
  vigenteDe: z.date(),
  observacoes: z.string().max(500).nullable(),
});

function lerData(bruto: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return null;
  const data = new Date(`${bruto}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

function textoOuNulo(valor: FormDataEntryValue | null): string | null {
  const texto = String(valor ?? "").trim();
  return texto === "" ? null : texto;
}

export async function acaoSalvarRegraEstorno(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const percentual = parseValorBr(String(formData.get("percentual") ?? ""));
  const limiteBruto = String(formData.get("parcelaLimite") ?? "").trim();
  const vigenteDe = lerData(String(formData.get("vigenteDe") ?? ""));

  if (percentual === null) return { erro: "Informe o percentual." };
  if (!/^\d+$/.test(limiteBruto)) return { erro: "Informe o limite de parcelas." };
  if (!vigenteDe) return { erro: "Informe a data de início da vigência." };

  const analise = esquema.safeParse({
    tipo: String(formData.get("tipo") ?? ""),
    categoriasVenda: formData.getAll("categoriasVenda").map(String).filter(Boolean),
    vendedorId: textoOuNulo(formData.get("vendedorId")),
    parcelaLimite: Number(limiteBruto),
    percentual,
    vigenteDe,
    observacoes: textoOuNulo(formData.get("observacoes")),
  });

  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? "Dados inválidos." };
  }

  await salvarRegraEstorno(analise.data, { id: sessao.id, nome: sessao.nome });

  revalidatePath("/configuracoes");
  return {
    sucesso:
      analise.data.parcelaLimite === 0
        ? "Regra gravada. Limite zero desliga o estorno para este caso."
        : `Regra gravada: ${analise.data.percentual}% abaixo de ${analise.data.parcelaLimite} parcela(s).`,
  };
}

export async function acaoEncerrarRegraEstorno(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "").trim();
  const em = lerData(String(formData.get("em") ?? "")) ?? new Date();
  if (!id) return { erro: "Regra não informada." };

  await encerrarRegraEstorno(id, em, { id: sessao.id, nome: sessao.nome });

  revalidatePath("/configuracoes");
  return { sucesso: "Regra encerrada. O histórico já apurado permanece intacto." };
}

/**
 * Faz as regras de estorno já cadastradas alcançarem o histórico.
 *
 * A regra é resolvida pela data do CANCELAMENTO. Cadastrada depois da
 * importação — que é o caso normal, porque a base vem primeiro —, ela começa a
 * valer no dia do cadastro e não encontra nenhum cancelamento anterior: a
 * apuração responde "sem regra vigente" e não cobra ninguém.
 *
 * Só recua a data. Percentual e limite de parcelas ficam como estão, e período
 * já encerrado não é tocado.
 */
export async function acaoAjustarVigenciaDasRegras(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  try {
    const resumo = await ajustarVigenciaDasRegras({ id: sessao.id, nome: sessao.nome });

    revalidatePath("/configuracoes");
    revalidatePath("/estornos");

    if (resumo.ajustadas === 0) {
      return {
        sucesso:
          "Nenhuma regra precisava de ajuste — todas já alcançam os cancelamentos importados.",
      };
    }

    return {
      sucesso:
        `${resumo.ajustadas} regra(s) passaram a valer desde ` +
        `${resumo.inicio.toLocaleDateString("pt-BR", { timeZone: "UTC" })}, que é a venda mais ` +
        "antiga da base. Nenhum percentual foi alterado — agora clique em Apurar estornos.",
    };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : "Falha ao ajustar a vigência." };
  }
}

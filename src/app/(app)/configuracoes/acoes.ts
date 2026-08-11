"use server";

import { revalidatePath } from "next/cache";
import type { DestinoComissao, SegmentoVenda } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { parseValorBr } from "@/lib/normalize";
import { formatarNumero } from "@/lib/format";
import { PARCELAS_CONFIGURAVEIS } from "./constantes";
import {
  ajustarVigenciaParaCobrirBase,
  salvarTabelaInterna,
  semearTabelasInternas,
} from "@/server/services/tabelas-internas";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const DESTINOS = ["INICIANTE", "VETERANO", "EXPERT", "SUPERVISOR", "GERENCIA"] as const;
const SEGMENTOS = ["IMOVEL", "AUTOMOVEL"] as const;

/**
 * Grava os percentuais de uma tabela.
 *
 * O formulário manda o quadro inteiro, então campo apagado significa parcela
 * que deixa de pagar — é assim que se tira uma parcela sem mexer no código.
 */
export async function acaoSalvarTabela(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const destino = String(formData.get("destino") ?? "") as DestinoComissao;
  const segmento = String(formData.get("segmento") ?? "") as SegmentoVenda;

  if (!DESTINOS.includes(destino as (typeof DESTINOS)[number])) {
    return { erro: "Tabela inválida." };
  }
  if (!SEGMENTOS.includes(segmento as (typeof SEGMENTOS)[number])) {
    return { erro: "Produto inválido." };
  }

  const faixas: { parcela: number; percentual: number }[] = [];

  for (let parcela = 1; parcela <= PARCELAS_CONFIGURAVEIS; parcela += 1) {
    const bruto = String(formData.get(`percentual_${parcela}`) ?? "").trim();
    if (!bruto) continue;

    const percentual = parseValorBr(bruto);
    if (percentual === null || percentual < 0 || percentual > 100) {
      return { erro: `Percentual inválido na parcela ${parcela}.` };
    }
    if (percentual > 0) faixas.push({ parcela, percentual });
  }

  await salvarTabelaInterna(
    { destino, segmento, faixas },
    { id: sessao.id, nome: sessao.nome },
  );

  revalidatePath("/configuracoes");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso:
      faixas.length === 0
        ? "Tabela salva sem nenhum percentual — nenhuma parcela paga por ela."
        : `Tabela salva com ${formatarNumero(faixas.length)} parcela(s) pagando.`,
  };
}

/** Cria o que ainda não existe, sem tocar no que já foi ajustado. */
export async function acaoSemear(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const resumo = await semearTabelasInternas({ id: sessao.id, nome: sessao.nome });

  revalidatePath("/configuracoes");

  if (resumo.tabelasCriadas === 0 && resumo.flexCriadas === 0) {
    return { sucesso: "Tudo já estava cadastrado. Nada foi alterado." };
  }

  return {
    sucesso:
      `${formatarNumero(resumo.tabelasCriadas)} tabela(s) e ` +
      `${formatarNumero(resumo.flexCriadas)} modalidade(s) de flex criadas. ` +
      "O que já existia foi preservado.",
  };
}

/**
 * Faz os percentuais já cadastrados alcançarem as vendas já importadas.
 *
 * A tela não pede data de vigência, e é bom que não peça: no uso normal os
 * percentuais valem "desde sempre" e mudá-los abre um período novo. Mas quem
 * cadastrou quando a criação usava a data de hoje ficou com tabelas que não
 * alcançam venda nenhuma, e sem esta ação não havia como corrigir pela
 * interface — só por dentro do banco.
 */
export async function acaoAjustarVigencia(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const resumo = await ajustarVigenciaParaCobrirBase({ id: sessao.id, nome: sessao.nome });

  revalidatePath("/configuracoes");
  revalidatePath("/comissoes-equipe");

  if (resumo.ajustadas === 0) {
    return {
      sucesso: "Nenhuma tabela precisava de ajuste — todas já alcançam as vendas importadas.",
    };
  }

  return {
    sucesso:
      `${formatarNumero(resumo.ajustadas)} tabela(s) passaram a valer desde ` +
      `${resumo.inicio.toLocaleDateString("pt-BR", { timeZone: "UTC" })}, que é a venda mais ` +
      "antiga da base. Nenhum percentual foi alterado — agora apure as comissões.",
  };
}

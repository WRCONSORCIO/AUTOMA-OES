import type { EtapaFluxo, OpcaoEtapaFluxo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarMoeda } from "@/lib/format";
import type { OpcaoApresentada } from "../dominio/motor";

/**
 * O que o cliente vê como opção em cada etapa.
 *
 * Três fontes, nunca hardcoded: as opções cadastradas na etapa, os planos
 * ativos do banco e os aparelhos ativos do banco. O id carrega o prefixo da
 * fonte para que a interpretação da resposta saiba o que fazer com a escolha.
 */

export const PREFIXO_PLANO = "plano:";
export const PREFIXO_APARELHO = "aparelho:";

export interface EtapaComOpcoes extends EtapaFluxo {
  opcoes: OpcaoEtapaFluxo[];
}

export async function opcoesDaEtapa(etapa: EtapaComOpcoes): Promise<OpcaoApresentada[]> {
  if (etapa.tipo === "DEVICE_SELECTION") return opcoesDeAparelhos();

  const config = lerConfig(etapa);
  if (config.fonte === "planos") return opcoesDePlanos();

  return etapa.opcoes
    .filter((opcao) => opcao.ativo)
    .sort((a, b) => a.ordem - b.ordem)
    .map((opcao) => ({ id: opcao.id, rotulo: opcao.rotulo, valor: opcao.valor }));
}

async function opcoesDePlanos(): Promise<OpcaoApresentada[]> {
  const planos = await prisma.plano.findMany({
    where: { status: "ATIVO" },
    orderBy: [{ destaque: "desc" }, { ordem: "asc" }, { criadoEm: "asc" }],
  });

  return planos.map((plano) => ({
    id: `${PREFIXO_PLANO}${plano.id}`,
    rotulo: plano.textoCliente?.trim()
      ? plano.textoCliente.trim()
      : `${plano.nome} — ${formatarMoeda(Number(plano.preco))}`,
    valor: plano.id,
  }));
}

async function opcoesDeAparelhos(): Promise<OpcaoApresentada[]> {
  const aparelhos = await prisma.aparelho.findMany({
    where: { status: "ATIVO" },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
  });

  return aparelhos.map((aparelho) => ({
    id: `${PREFIXO_APARELHO}${aparelho.id}`,
    rotulo: [aparelho.icone, aparelho.nome].filter(Boolean).join(" "),
    valor: aparelho.chave,
  }));
}

export interface ConfigEtapa {
  fonte?: "planos";
  titulo?: string;
  rotuloBotao?: string;
  rodape?: string;
  /** Nome da variável onde o INPUT guarda a resposta. */
  variavel?: string;
}

export function lerConfig(etapa: { config: unknown }): ConfigEtapa {
  const bruto = etapa.config;
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) return bruto as ConfigEtapa;
  return {};
}

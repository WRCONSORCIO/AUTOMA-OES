import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { obterProvedorPagamento } from "../pagamentos/fabrica";
import { resolverProvedorWhatsApp } from "../whatsapp/fabrica";

/**
 * Saúde do sistema.
 *
 * Cada dependência responde por si, e a falha de uma não derruba a checagem das
 * outras — a página existe justamente para dizer *qual* delas caiu.
 */

export type EstadoServico = "ok" | "degradado" | "indisponivel";

export interface Verificacao {
  servico: string;
  estado: EstadoServico;
  detalhe: string;
}

export interface Saude {
  ok: boolean;
  verificadoEm: string;
  servicos: Verificacao[];
}

export async function verificarSaude(): Promise<Saude> {
  const servicos = await Promise.all([
    verificarBanco(),
    verificarWhatsApp(),
    verificarPagamento(),
    verificarConfiguracaoMinima(),
  ]);

  return {
    // Degradado não é queda: o sistema sobe sem WhatsApp e sem gateway, e a
    // página de saúde precisa distinguir "falta configurar" de "está fora".
    ok: servicos.every((servico) => servico.estado !== "indisponivel"),
    verificadoEm: new Date().toISOString(),
    servicos,
  };
}

async function verificarBanco(): Promise<Verificacao> {
  const inicio = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      servico: "Banco de dados",
      estado: "ok",
      detalhe: `PostgreSQL respondeu em ${Date.now() - inicio}ms`,
    };
  } catch (erro) {
    return {
      servico: "Banco de dados",
      estado: "indisponivel",
      detalhe: erro instanceof Error ? erro.message : "sem conexão",
    };
  }
}

async function verificarWhatsApp(): Promise<Verificacao> {
  try {
    const { provider, simulado } = await resolverProvedorWhatsApp();

    if (simulado) {
      return {
        servico: "WhatsApp",
        estado: "degradado",
        detalhe: "modo simulação — nenhuma mensagem sai do servidor",
      };
    }

    const estado = await provider.estadoConexao();
    return {
      servico: "WhatsApp",
      estado: estado.conectado ? "ok" : "indisponivel",
      detalhe: estado.detalhe ?? provider.nome,
    };
  } catch (erro) {
    return {
      servico: "WhatsApp",
      estado: "indisponivel",
      detalhe: erro instanceof Error ? erro.message : "falha ao consultar",
    };
  }
}

async function verificarPagamento(): Promise<Verificacao> {
  try {
    const provedor = await obterProvedorPagamento();

    if (!provedor.configurado) {
      return { servico: "Pagamentos", estado: "degradado", detalhe: "nenhum gateway configurado" };
    }
    if (provedor.simulado) {
      return { servico: "Pagamentos", estado: "degradado", detalhe: "gateway em modo simulação" };
    }

    const resultado = await provedor.testarConexao();
    return {
      servico: "Pagamentos",
      estado: resultado.ok ? "ok" : "indisponivel",
      detalhe: resultado.detalhe,
    };
  } catch (erro) {
    return {
      servico: "Pagamentos",
      estado: "indisponivel",
      detalhe: erro instanceof Error ? erro.message : "falha ao consultar",
    };
  }
}

/**
 * O que impede o atendimento de funcionar mesmo com tudo no ar: fluxo
 * principal ausente ou catálogo vazio.
 */
async function verificarConfiguracaoMinima(): Promise<Verificacao> {
  try {
    const [principal, planos, aparelhos] = await Promise.all([
      prisma.fluxo.count({ where: { tipo: "PRINCIPAL", status: "ATIVO" } }),
      prisma.plano.count({ where: { status: "ATIVO" } }),
      prisma.aparelho.count({ where: { status: "ATIVO" } }),
    ]);

    const faltas: string[] = [];
    if (principal === 0) faltas.push("nenhum fluxo principal ativo");
    if (planos === 0) faltas.push("nenhum plano ativo");
    if (aparelhos === 0) faltas.push("nenhum aparelho ativo");

    if (faltas.length > 0) {
      return { servico: "Atendimento", estado: "degradado", detalhe: faltas.join("; ") };
    }

    return {
      servico: "Atendimento",
      estado: "ok",
      detalhe: `${planos} plano(s) e ${aparelhos} aparelho(s) ativos`,
    };
  } catch (erro) {
    return {
      servico: "Atendimento",
      estado: "indisponivel",
      detalhe: erro instanceof Error ? erro.message : "falha ao consultar",
    };
  }
}

/** Versão pública da saúde: sem detalhe que exponha configuração interna. */
export function resumoPublico(saude: Saude): {
  status: string;
  verificadoEm: string;
  servicos: { servico: string; estado: EstadoServico }[];
} {
  void env;
  return {
    status: saude.ok ? "ok" : "indisponivel",
    verificadoEm: saude.verificadoEm,
    servicos: saude.servicos.map(({ servico, estado }) => ({ servico, estado })),
  };
}

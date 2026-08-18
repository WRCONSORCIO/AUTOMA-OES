import type { InstanciaWhatsApp } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { decifrar } from "../servicos/segredos";
import { EvolutionProvider } from "./evolution";
import { SimuladorProvider } from "./simulador";
import type { WhatsAppProvider } from "./tipos";

/**
 * Escolhe o provedor de WhatsApp.
 *
 * Ordem: instância cadastrada no painel, depois variáveis de ambiente, depois
 * simulação. A precedência do painel é intencional — trocar credencial em
 * produção não deveria exigir deploy.
 *
 * O sistema nunca fica sem provedor: sem configuração, cai no simulador e
 * segue executável, com a tela de configuração dizendo o que falta.
 */
export interface ProvedorResolvido {
  provider: WhatsAppProvider;
  instancia: InstanciaWhatsApp | null;
  /** `true` quando nada foi configurado e o simulador entrou no lugar. */
  simulado: boolean;
}

export async function resolverProvedorWhatsApp(
  instanciaId?: string | null,
): Promise<ProvedorResolvido> {
  const instancia = await buscarInstancia(instanciaId);

  if (instancia) {
    const apiKey = decifrar(instancia.apiKeyCifrada);

    if (instancia.provedor === "EVOLUTION" && instancia.apiUrl && apiKey) {
      return {
        provider: new EvolutionProvider({
          apiUrl: instancia.apiUrl,
          apiKey,
          instancia: instancia.instancia ?? "",
        }),
        instancia,
        simulado: false,
      };
    }
  }

  const ambiente = env();
  if (
    ambiente.WHATSAPP_PROVIDER === "EVOLUTION" &&
    ambiente.WHATSAPP_API_URL &&
    ambiente.WHATSAPP_API_KEY
  ) {
    return {
      provider: new EvolutionProvider({
        apiUrl: ambiente.WHATSAPP_API_URL,
        apiKey: ambiente.WHATSAPP_API_KEY,
        instancia: ambiente.WHATSAPP_INSTANCE ?? "",
      }),
      instancia,
      simulado: false,
    };
  }

  return { provider: new SimuladorProvider(), instancia, simulado: true };
}

async function buscarInstancia(instanciaId?: string | null): Promise<InstanciaWhatsApp | null> {
  if (instanciaId) {
    return prisma.instanciaWhatsApp.findUnique({ where: { id: instanciaId } });
  }

  return prisma.instanciaWhatsApp.findFirst({
    where: { status: "ATIVO" },
    orderBy: [{ padrao: "desc" }, { criadoEm: "asc" }],
  });
}

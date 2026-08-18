import { prisma } from "@/lib/prisma";
import type { ClienteAtendimento } from "@prisma/client";
import { normalizarTelefone } from "../dominio/telefone";

/**
 * Localiza o cliente pelo número ou cria um novo.
 *
 * Um número, um cliente: a chave única do telefone normalizado é o que impede
 * o mesmo cliente virar dois cadastros quando o provedor muda o formato do JID
 * entre um evento e outro.
 */
export async function localizarOuCriarCliente(
  telefoneBruto: string,
  dados: { nome?: string | null; whatsappId?: string | null } = {},
): Promise<ClienteAtendimento | null> {
  const telefone = normalizarTelefone(telefoneBruto);
  if (!telefone) return null;

  const existente = await prisma.clienteAtendimento.findUnique({
    where: { telefone: telefone.numero },
  });

  if (existente) {
    // O nome do perfil pode aparecer só no segundo contato; quando aparece,
    // preenchemos. Nunca sobrescrevemos um nome já registrado — o atendente
    // pode tê-lo corrigido no painel.
    const precisaNome = !existente.nome && dados.nome;
    const precisaJid = !existente.whatsappId && dados.whatsappId;

    if (!precisaNome && !precisaJid) return existente;

    return prisma.clienteAtendimento.update({
      where: { id: existente.id },
      data: {
        nome: precisaNome ? dados.nome : undefined,
        whatsappId: precisaJid ? dados.whatsappId : undefined,
      },
    });
  }

  return prisma.clienteAtendimento.create({
    data: {
      telefone: telefone.numero,
      telefoneExibicao: telefone.exibicao,
      nome: dados.nome ?? null,
      whatsappId: dados.whatsappId ?? null,
    },
  });
}

/** Nome usado nas mensagens. Sem nome no perfil, evita o "Olá, null!". */
export function nomeParaMensagem(cliente: { nome: string | null }): string {
  return cliente.nome?.trim() || "";
}

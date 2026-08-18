"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/auditoria";
import { variaveisDesconhecidas } from "@/server/atendimento/dominio/variaveis";
import { MODELOS_PADRAO } from "@/server/atendimento/mensagens-padrao";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const esquema = z.object({
  chave: z.string().trim().min(1),
  conteudo: z.string().trim().min(1, "A mensagem não pode ficar vazia"),
});

export async function acaoSalvarMensagem(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("mensagensBot", "editar");

  const parsed = esquema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  // Variável escrita errado não quebra o envio — ela some do texto —, mas o
  // administrador precisa saber antes do cliente receber a frase truncada.
  const desconhecidas = variaveisDesconhecidas(parsed.data.conteudo);
  if (desconhecidas.length > 0) {
    return {
      erro: `Variável não reconhecida: ${desconhecidas.map((nome) => `{{${nome}}}`).join(", ")}`,
    };
  }

  const anterior = await prisma.modeloMensagem.findUnique({ where: { chave: parsed.data.chave } });
  if (!anterior) return { erro: "Mensagem não encontrada." };

  await prisma.modeloMensagem.update({
    where: { chave: parsed.data.chave },
    data: { conteudo: parsed.data.conteudo },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "ModeloMensagem",
    entidadeId: anterior.id,
    descricao: `Mensagem "${anterior.titulo}" alterada`,
    dadosAntes: { conteudo: anterior.conteudo },
    dadosDepois: { conteudo: parsed.data.conteudo },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/atendimento/mensagens");
  return { sucesso: "Mensagem salva." };
}

/** Devolve o texto de fábrica, para desfazer uma edição infeliz. */
export async function acaoRestaurarMensagem(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("mensagensBot", "editar");
  const chave = String(formData.get("chave") ?? "");

  const padrao = MODELOS_PADRAO.find((modelo) => modelo.chave === chave);
  if (!padrao) return { erro: "Esta mensagem não tem texto padrão." };

  await prisma.modeloMensagem.update({
    where: { chave },
    data: { conteudo: padrao.conteudo },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "ModeloMensagem",
    descricao: `Mensagem "${padrao.titulo}" restaurada para o texto padrão`,
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/atendimento/mensagens");
  return { sucesso: "Texto padrão restaurado." };
}

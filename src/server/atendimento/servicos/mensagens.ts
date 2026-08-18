import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aplicarVariaveis, type Variaveis } from "../dominio/variaveis";
import { MODELOS_PADRAO } from "../mensagens-padrao";

/**
 * Textos do bot.
 *
 * A ordem de precedência é sempre a mesma: o que o administrador salvou no
 * painel vence; o padrão de fábrica só entra quando a chave ainda não existe no
 * banco (instalação nova, chave criada por uma versão mais recente). Assim
 * nenhuma mensagem some do WhatsApp por causa de um seed que não rodou.
 */
export async function textoDaMensagem(
  chave: string,
  variaveis: Variaveis = {},
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const modelo = await tx.modeloMensagem.findUnique({ where: { chave } });
  const conteudo = modelo?.conteudo ?? MODELOS_PADRAO.find((item) => item.chave === chave)?.conteudo;

  if (!conteudo) return "";
  return aplicarVariaveis(conteudo, variaveis);
}

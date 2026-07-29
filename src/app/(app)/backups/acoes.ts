"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/server/auth/session";
import { gerarBackup } from "@/server/services/backup";
import { formatarBytes } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

export async function acaoGerarBackup(
  _anterior: EstadoAcao,
  _formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("backups", "criar");

  try {
    const resultado = await gerarBackup("MANUAL", { id: sessao.id, nome: sessao.nome });
    revalidatePath("/backups");
    return {
      sucesso: `Backup gerado: ${resultado.nomeArquivo} (${formatarBytes(resultado.tamanhoBytes)}).`,
    };
  } catch (erro) {
    revalidatePath("/backups");
    return { erro: erro instanceof Error ? erro.message : "Falha ao gerar o backup." };
  }
}

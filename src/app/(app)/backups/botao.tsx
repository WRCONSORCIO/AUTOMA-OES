"use client";

import { useActionState } from "react";
import { HardDriveDownload } from "lucide-react";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoGerarBackup } from "./acoes";

export function BotaoGerarBackup() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoGerarBackup, {});

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao>
        <HardDriveDownload className="h-4 w-4" />
        Gerar backup
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

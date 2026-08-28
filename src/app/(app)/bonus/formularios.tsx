"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoReapurarBonus } from "./acoes";

export function BotaoReapurarBonus() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoReapurarBonus, {});

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao variante="secundario">
        <RefreshCw className="h-4 w-4" />
        Reapurar bônus
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

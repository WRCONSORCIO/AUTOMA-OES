"use client";

import { useActionState } from "react";
import { Calculator } from "lucide-react";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoApurar } from "./acoes";

export function BotaoApurar() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoApurar, {});

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao variante="secundario">
        <Calculator className="h-4 w-4" />
        Apurar comissões
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

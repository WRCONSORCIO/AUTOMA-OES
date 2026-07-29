"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Botao } from "@/components/ui";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

export type AcaoFormulario = (
  estado: EstadoAcao,
  formData: FormData,
) => Promise<EstadoAcao>;

export function MensagemAcao({ estado }: { estado: EstadoAcao }) {
  if (!estado.erro && !estado.sucesso) return null;

  return (
    <p
      role="status"
      className={
        estado.erro
          ? "rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-critico)]"
          : "rounded-lg bg-[color-mix(in_oklab,var(--color-bom)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-bom)]"
      }
    >
      {estado.erro ?? estado.sucesso}
    </p>
  );
}

export function BotaoAcao({
  children,
  variante = "primario",
}: {
  children: ReactNode;
  variante?: "primario" | "secundario";
}) {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" variante={variante} disabled={pending}>
      {pending ? "Processando…" : children}
    </Botao>
  );
}

/**
 * Formulário com estado de ação padronizado: mensagem de erro/sucesso acima e
 * botão que reflete o estado de envio.
 */
export function FormularioAcao({
  acao,
  children,
  rotuloBotao,
  className = "flex flex-col gap-4",
}: {
  acao: AcaoFormulario;
  children: ReactNode;
  rotuloBotao: ReactNode;
  className?: string;
}) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acao, {});

  return (
    <form action={despachar} className={className}>
      <MensagemAcao estado={estado} />
      {children}
      <div>
        <BotaoAcao>{rotuloBotao}</BotaoAcao>
      </div>
    </form>
  );
}

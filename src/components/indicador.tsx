import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Indicador({
  rotulo,
  valor,
  detalhe,
  icone,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  icone?: ReactNode;
  tom?: "neutro" | "bom" | "atencao" | "critico";
}) {
  const cores = {
    neutro: "text-[var(--color-texto)]",
    bom: "text-[var(--color-bom)]",
    atencao: "text-[var(--color-atencao)]",
    critico: "text-[var(--color-critico)]",
  } as const;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--color-texto-2)]">{rotulo}</p>
        {icone ? <span className="text-[var(--color-texto-3)]">{icone}</span> : null}
      </div>
      <p className={cn("numerico mt-2 text-2xl font-semibold tracking-tight", cores[tom])}>
        {valor}
      </p>
      {detalhe ? (
        <p className="mt-1 text-xs text-[var(--color-texto-3)]">{detalhe}</p>
      ) : null}
    </div>
  );
}

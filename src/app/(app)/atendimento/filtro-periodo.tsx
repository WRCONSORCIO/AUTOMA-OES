import Link from "next/link";
import { Entrada } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PERIODOS, type IntervaloPeriodo, type ChavePeriodo } from "./periodo";

/**
 * Filtro de período por navegação GET: o estado mora na URL, então a visão
 * filtrada pode ser compartilhada e sobrevive a um F5.
 */
export function FiltroPeriodo({
  base,
  intervalo,
}: {
  base: string;
  intervalo: IntervaloPeriodo;
}) {
  const chaves = Object.keys(PERIODOS) as ChavePeriodo[];

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-borda)] p-1">
        {chaves
          .filter((chave) => chave !== "personalizado")
          .map((chave) => (
            <Link
              key={chave}
              href={`${base}?periodo=${chave}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                intervalo.chave === chave
                  ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                  : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
              )}
            >
              {PERIODOS[chave]}
            </Link>
          ))}
      </div>

      <form action={base} className="flex items-end gap-2">
        <input type="hidden" name="periodo" value="personalizado" />
        <Entrada type="date" name="de" defaultValue={intervalo.de} className="w-[9.5rem]" />
        <Entrada type="date" name="ate" defaultValue={intervalo.ate} className="w-[9.5rem]" />
        <button
          type="submit"
          className="h-10 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
        >
          Aplicar
        </button>
      </form>
    </div>
  );
}

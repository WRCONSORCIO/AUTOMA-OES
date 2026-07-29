import Link from "next/link";
import { formatarNumero } from "@/lib/format";
import { montarQuery, type ParametrosBusca } from "@/lib/filtros";

const CLASSE =
  "inline-flex h-9 items-center rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]";

export function Paginacao({
  pagina,
  totalPaginas,
  total,
  base,
  parametros,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  base: string;
  parametros: ParametrosBusca;
}) {
  if (totalPaginas <= 1) {
    return (
      <p className="text-sm text-[var(--color-texto-2)]">
        {formatarNumero(total)} registro(s)
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[var(--color-texto-2)]">
        Página {pagina} de {totalPaginas} · {formatarNumero(total)} registro(s)
      </p>
      <div className="flex gap-2">
        {pagina > 1 ? (
          <Link href={`${base}${montarQuery(parametros, { pagina: pagina - 1 })}`} className={CLASSE}>
            Anterior
          </Link>
        ) : null}
        {pagina < totalPaginas ? (
          <Link href={`${base}${montarQuery(parametros, { pagina: pagina + 1 })}`} className={CLASSE}>
            Próxima
          </Link>
        ) : null}
      </div>
    </div>
  );
}

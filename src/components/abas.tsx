import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ParametrosBusca } from "@/lib/filtros";

/**
 * Abas dentro de uma mesma página.
 *
 * A aba escolhida vive na URL, não em estado do cliente: o link continua
 * compartilhável, o botão voltar funciona, e cada aba é renderizada no
 * servidor sem carregar as outras.
 */

export interface Aba {
  chave: string;
  rotulo: string;
  /** Número mostrado ao lado do rótulo, quando ajuda a decidir onde clicar. */
  contador?: number;
}

export function lerAba(parametros: ParametrosBusca, abas: readonly Aba[], padrao?: string): string {
  const bruto = parametros.aba;
  const escolhida = Array.isArray(bruto) ? bruto[0] : bruto;
  const valida = abas.some((aba) => aba.chave === escolhida);
  return valida && escolhida ? escolhida : (padrao ?? abas[0]?.chave ?? "");
}

export function Abas({
  abas,
  ativa,
  base,
  parametros,
}: {
  abas: readonly Aba[];
  ativa: string;
  base: string;
  /** Demais parâmetros da URL, preservados ao trocar de aba. */
  parametros?: ParametrosBusca;
}) {
  function href(chave: string): string {
    const query = new URLSearchParams();
    for (const [nome, valor] of Object.entries(parametros ?? {})) {
      if (nome === "aba" || valor === undefined) continue;
      query.set(nome, Array.isArray(valor) ? (valor[0] ?? "") : valor);
    }
    query.set("aba", chave);
    return `${base}?${query.toString()}`;
  }

  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 border-b border-[var(--color-borda)]"
    >
      {abas.map((aba) => {
        const selecionada = aba.chave === ativa;

        return (
          <Link
            key={aba.chave}
            href={href(aba.chave)}
            role="tab"
            aria-selected={selecionada}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors",
              selecionada
                ? "border-[var(--color-marca)] font-medium text-[var(--color-marca-forte)]"
                : "border-transparent text-[var(--color-texto-2)] hover:border-[var(--color-borda-forte)] hover:text-[var(--color-texto)]",
            )}
          >
            {aba.rotulo}
            {aba.contador !== undefined && aba.contador > 0 ? (
              <span
                className={cn(
                  "numerico rounded-full px-1.5 py-0.5 text-xs",
                  selecionada
                    ? "bg-[var(--color-marca-suave)] text-[var(--color-marca-forte)]"
                    : "bg-[var(--color-superficie-3)] text-[var(--color-texto-2)]",
                )}
              >
                {aba.contador}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

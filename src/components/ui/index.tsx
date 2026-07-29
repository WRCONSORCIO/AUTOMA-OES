import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 px-5 pt-5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-[var(--color-texto-2)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Botão
// ---------------------------------------------------------------------------

const botao = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variante: {
        primario:
          "bg-[var(--color-marca)] text-white hover:bg-[var(--color-marca-forte)] dark:text-[#0b0b0b]",
        secundario:
          "border border-[var(--color-borda-forte)] bg-[var(--color-superficie-2)] hover:bg-[var(--color-superficie-3)]",
        sutil: "hover:bg-[var(--color-superficie-3)]",
        perigo: "bg-[var(--color-critico)] text-white hover:opacity-90",
      },
      tamanho: {
        pequeno: "h-8 px-3",
        medio: "h-10 px-4",
        icone: "h-9 w-9",
      },
    },
    defaultVariants: { variante: "primario", tamanho: "medio" },
  },
);

export interface BotaoProps
  extends ComponentProps<"button">,
    VariantProps<typeof botao> {}

export function Botao({ className, variante, tamanho, ...props }: BotaoProps) {
  return <button className={cn(botao({ variante, tamanho }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tom: {
        neutro:
          "bg-[var(--color-superficie-3)] text-[var(--color-texto-2)] border border-[var(--color-borda)]",
        marca: "bg-[var(--color-marca-suave)] text-[var(--color-marca-forte)]",
        bom: "bg-[color-mix(in_oklab,var(--color-bom)_15%,transparent)] text-[var(--color-bom)]",
        atencao:
          "bg-[color-mix(in_oklab,var(--color-atencao)_15%,transparent)] text-[var(--color-atencao)]",
        grave:
          "bg-[color-mix(in_oklab,var(--color-grave)_15%,transparent)] text-[var(--color-grave)]",
        critico:
          "bg-[color-mix(in_oklab,var(--color-critico)_15%,transparent)] text-[var(--color-critico)]",
      },
    },
    defaultVariants: { tom: "neutro" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badge> {}

export function Badge({ className, tom, ...props }: BadgeProps) {
  return <span className={cn(badge({ tom }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export function Campo({
  rotulo,
  dica,
  children,
  className,
}: {
  rotulo: string;
  dica?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium text-[var(--color-texto-2)]">{rotulo}</span>
      {children}
      {dica ? <span className="text-xs text-[var(--color-texto-3)]">{dica}</span> : null}
    </label>
  );
}

const controleBase =
  "h-10 w-full rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-2)] px-3 text-sm text-[var(--color-texto)] placeholder:text-[var(--color-texto-3)] disabled:opacity-60";

export function Entrada({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controleBase, className)} {...props} />;
}

export function Selecao({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controleBase, "pr-8", className)} {...props} />;
}

export function AreaTexto({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(controleBase, "h-auto min-h-24 py-2 leading-relaxed", className)} {...props} />
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export function Tabela({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="tabela-rolavel">
      <table className={cn("w-full min-w-max border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Cabecalho({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "border-b border-[var(--color-borda)] text-left text-xs uppercase tracking-wide text-[var(--color-texto-3)]",
        className,
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-[var(--color-borda)] last:border-0 hover:bg-[var(--color-superficie-3)]",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function TabelaVazia({ colunas, mensagem }: { colunas: number; mensagem: string }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-12 text-center text-sm text-[var(--color-texto-3)]">
        {mensagem}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho de página
// ---------------------------------------------------------------------------

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-texto-2)]">{descricao}</p>
        ) : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

export function Aviso({
  tom = "atencao",
  children,
}: {
  tom?: "atencao" | "critico" | "bom" | "marca";
  children: ReactNode;
}) {
  const cores = {
    atencao: "border-[var(--color-atencao)] text-[var(--color-atencao)]",
    critico: "border-[var(--color-critico)] text-[var(--color-critico)]",
    bom: "border-[var(--color-bom)] text-[var(--color-bom)]",
    marca: "border-[var(--color-marca)] text-[var(--color-marca-forte)]",
  } as const;

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 bg-[var(--color-superficie-3)] px-4 py-3 text-sm",
        cores[tom],
      )}
    >
      <span className="text-[var(--color-texto)]">{children}</span>
    </div>
  );
}

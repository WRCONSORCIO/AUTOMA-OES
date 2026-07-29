import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui";

export default function SemPermissao() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-atencao)_15%,transparent)]">
            <ShieldAlert className="h-6 w-6 text-[var(--color-atencao)]" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Acesso não autorizado</h1>
            <p className="mt-1 text-sm text-[var(--color-texto-2)]">
              Seu perfil não tem permissão para este módulo. Fale com o administrador
              do sistema se precisar desse acesso.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--color-marca)] text-sm font-medium text-white hover:bg-[var(--color-marca-forte)] dark:text-[#0b0b0b]"
          >
            Voltar ao dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

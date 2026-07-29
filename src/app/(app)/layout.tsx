import { LogOut } from "lucide-react";
import { exigirSessao } from "@/server/auth/session";
import { modulosVisiveis, ROTULO_PERFIL } from "@/server/auth/rbac";
import { sair } from "@/server/auth/actions";
import { Sidebar } from "@/components/layout/sidebar";
import { AlternarTema } from "@/components/alternar-tema";
import { Badge, Botao } from "@/components/ui";

export default async function LayoutAplicacao({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  const modulos = modulosVisiveis(sessao.perfil);

  return (
    <div className="flex min-h-dvh">
      <Sidebar modulos={modulos} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[var(--color-borda)] bg-[var(--color-superficie-2)]/90 px-4 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-3 lg:hidden">
            <Sidebar modulos={modulos} />
            <span className="truncate text-sm font-semibold">WR Consórcio</span>
          </div>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{sessao.nome}</p>
              <p className="text-xs text-[var(--color-texto-3)]">{sessao.email}</p>
            </div>
            <Badge tom="marca">{ROTULO_PERFIL[sessao.perfil]}</Badge>
            <AlternarTema />
            <form action={sair}>
              <Botao variante="secundario" tamanho="icone" type="submit" aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </Botao>
            </form>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
          <div className="mx-auto flex max-w-[100rem] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

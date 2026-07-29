import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { lerSessao } from "@/server/auth/session";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar" };

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (await lerSessao()) redirect("/");

  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-superficie)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-marca)] text-xl font-bold text-white">
            WR
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">WR Consórcio</h1>
          <p className="mt-1 text-sm text-[var(--color-texto-2)]">
            Sistema interno de gestão comercial
          </p>
        </div>

        <FormularioLogin
          avisoInicial={
            erro === "sessao" ? "Sua sessão expirou. Entre novamente para continuar." : null
          }
        />

        <p className="mt-6 text-center text-xs text-[var(--color-texto-3)]">
          Acesso restrito. Todas as ações são registradas em auditoria.
        </p>
      </div>
    </main>
  );
}

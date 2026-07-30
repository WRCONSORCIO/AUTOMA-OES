import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sistemaInstalado } from "@/server/services/instalacao";
import { env } from "@/lib/env";
import { Card, CardContent } from "@/components/ui";
import { FormularioConfiguracaoInicial } from "./formulario";

export const metadata: Metadata = { title: "Configuração inicial" };
export const dynamic = "force-dynamic";

export default async function PaginaConfiguracaoInicial() {
  // A tela só existe enquanto o sistema não tem nenhum usuário.
  if (await sistemaInstalado()) redirect("/login");

  // Problema de configuração é mostrado aqui, antes de o formulário aparecer.
  let erroAmbiente: string | null = null;
  try {
    env();
  } catch (erro) {
    erroAmbiente = erro instanceof Error ? erro.message : "Configuração de ambiente inválida.";
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-superficie)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-marca)] text-xl font-bold text-white">
            WR
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Configuração inicial</h1>
          <p className="mt-2 text-sm text-[var(--color-texto-2)]">
            Crie o acesso do administrador. A estrutura inicial — administradora, gerências,
            equipes, modalidades de flex e a tabela de comissão de Iniciante — é criada junto.
          </p>
        </div>

        <Card>
          <CardContent>
            {erroAmbiente ? (
              <div className="flex flex-col gap-3 text-sm">
                <p className="rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-[var(--color-critico)]">
                  {erroAmbiente}
                </p>
                <p className="text-[var(--color-texto-2)]">
                  Cadastre as variáveis de ambiente no servidor e publique novamente. São
                  necessárias <code className="numerico">DATABASE_URL</code>,{" "}
                  <code className="numerico">DIRECT_URL</code> e{" "}
                  <code className="numerico">AUTH_SECRET</code> — esta última com no mínimo 32
                  caracteres.
                </p>
              </div>
            ) : (
              <FormularioConfiguracaoInicial />
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--color-texto-3)]">
          Esta tela se fecha sozinha assim que o primeiro usuário existir.
        </p>
      </div>
    </main>
  );
}

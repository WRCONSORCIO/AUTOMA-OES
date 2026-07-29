"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, LogIn } from "lucide-react";
import { entrar, type EstadoLogin } from "@/server/auth/actions";
import { Botao, Campo, Card, CardContent, Entrada } from "@/components/ui";

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" className="w-full" disabled={pending}>
      <LogIn className="h-4 w-4" />
      {pending ? "Entrando…" : "Entrar"}
    </Botao>
  );
}

export function FormularioLogin({ avisoInicial }: { avisoInicial: string | null }) {
  const [estado, acao] = useActionState<EstadoLogin, FormData>(entrar, {});
  const mensagem = estado.erro ?? avisoInicial;

  return (
    <Card>
      <CardContent>
        <form action={acao} className="flex flex-col gap-4">
          {mensagem ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-critico)]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {mensagem}
            </p>
          ) : null}

          <Campo rotulo="E-mail">
            <Entrada
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="voce@wrconsorcio.com"
            />
          </Campo>

          <Campo rotulo="Senha">
            <Entrada name="senha" type="password" autoComplete="current-password" required />
          </Campo>

          <BotaoEnviar />
        </form>
      </CardContent>
    </Card>
  );
}

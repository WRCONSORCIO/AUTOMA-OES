"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Rocket } from "lucide-react";
import { Botao, Campo, Entrada } from "@/components/ui";
import { acaoConfiguracaoInicial, type EstadoAcao } from "./acoes";

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" className="w-full" disabled={pending}>
      <Rocket className="h-4 w-4" />
      {pending ? "Configurando…" : "Criar acesso e concluir"}
    </Botao>
  );
}

export function FormularioConfiguracaoInicial() {
  const [estado, acao] = useActionState<EstadoAcao, FormData>(acaoConfiguracaoInicial, {});

  return (
    <form action={acao} className="flex flex-col gap-4">
      {estado.erro ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-critico)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.erro}
        </p>
      ) : null}

      <Campo rotulo="Seu nome">
        <Entrada name="nome" required minLength={3} autoComplete="name" />
      </Campo>

      <Campo rotulo="E-mail de acesso">
        <Entrada name="email" type="email" required autoComplete="username" />
      </Campo>

      <Campo rotulo="Senha" dica="Mínimo de 8 caracteres.">
        <Entrada name="senha" type="password" required minLength={8} autoComplete="new-password" />
      </Campo>

      <Campo rotulo="Confirme a senha">
        <Entrada
          name="confirmacao"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Campo>

      <BotaoEnviar />
    </form>
  );
}

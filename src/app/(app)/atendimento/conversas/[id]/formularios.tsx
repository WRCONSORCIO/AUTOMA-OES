"use client";

import { useActionState } from "react";
import { AreaTexto, Botao } from "@/components/ui";
import { MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoAssumirConversa,
  acaoDevolverAoBot,
  acaoEncerrarConversa,
  acaoResponder,
} from "../acoes";

export function AcoesConversa({
  id,
  status,
  podeEditar,
}: {
  id: string;
  status: string;
  podeEditar: boolean;
}) {
  const [estadoAssumir, assumir] = useActionState<EstadoAcao, FormData>(acaoAssumirConversa, {});
  const [estadoDevolver, devolver] = useActionState<EstadoAcao, FormData>(acaoDevolverAoBot, {});
  const [estadoEncerrar, encerrar] = useActionState<EstadoAcao, FormData>(acaoEncerrarConversa, {});

  if (!podeEditar) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "HUMAN" && status !== "CLOSED" ? (
        <form action={assumir}>
          <input type="hidden" name="id" value={id} />
          <Botao type="submit" tamanho="pequeno">
            Assumir atendimento
          </Botao>
        </form>
      ) : null}

      {status === "HUMAN" ? (
        <form action={devolver}>
          <input type="hidden" name="id" value={id} />
          <Botao type="submit" variante="secundario" tamanho="pequeno">
            Devolver para o bot
          </Botao>
        </form>
      ) : null}

      {status !== "CLOSED" ? (
        <form action={encerrar}>
          <input type="hidden" name="id" value={id} />
          <Botao type="submit" variante="sutil" tamanho="pequeno">
            Encerrar conversa
          </Botao>
        </form>
      ) : null}

      <MensagemAcao
        estado={
          estadoAssumir.erro || estadoAssumir.sucesso
            ? estadoAssumir
            : estadoDevolver.erro || estadoDevolver.sucesso
              ? estadoDevolver
              : estadoEncerrar
        }
      />
    </div>
  );
}

export function ResponderCliente({ id, status }: { id: string; status: string }) {
  const [estado, responder] = useActionState<EstadoAcao, FormData>(acaoResponder, {});

  if (status === "CLOSED") {
    return (
      <p className="text-sm text-[var(--color-texto-3)]">
        Conversa encerrada. Uma nova mensagem do cliente abre outra conversa.
      </p>
    );
  }

  return (
    <form action={responder} className="flex flex-col gap-3">
      <MensagemAcao estado={estado} />
      <input type="hidden" name="id" value={id} />
      <AreaTexto
        name="texto"
        rows={3}
        required
        placeholder="Escreva a resposta que o cliente vai receber no WhatsApp"
      />
      <div className="flex items-center gap-3">
        <Botao type="submit">Enviar mensagem</Botao>
        {status !== "HUMAN" ? (
          <span className="text-xs text-[var(--color-texto-3)]">
            Responder assume o atendimento: o bot para de responder nesta conversa.
          </span>
        ) : null}
      </div>
    </form>
  );
}

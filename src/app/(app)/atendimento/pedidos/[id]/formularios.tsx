"use client";

import { useActionState } from "react";
import { Botao } from "@/components/ui";
import { MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoCancelarPedido,
  acaoConfirmarPagamentoSimulado,
  acaoGerarNovaCobranca,
} from "../acoes";

export function AcoesPedido({
  id,
  status,
  modoSimulado,
}: {
  id: string;
  status: string;
  modoSimulado: boolean;
}) {
  const [estadoCobranca, gerar] = useActionState<EstadoAcao, FormData>(acaoGerarNovaCobranca, {});
  const [estadoCancelar, cancelar] = useActionState<EstadoAcao, FormData>(acaoCancelarPedido, {});
  const [estadoSimulado, confirmar] = useActionState<EstadoAcao, FormData>(
    acaoConfirmarPagamentoSimulado,
    {},
  );

  const emAberto = status !== "PAID" && status !== "REFUNDED";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {emAberto ? (
          <form action={gerar}>
            <input type="hidden" name="id" value={id} />
            <Botao type="submit" tamanho="pequeno">
              Gerar nova cobrança
            </Botao>
          </form>
        ) : null}

        {emAberto ? (
          <form action={cancelar}>
            <input type="hidden" name="id" value={id} />
            <Botao type="submit" variante="sutil" tamanho="pequeno">
              Cancelar pedido
            </Botao>
          </form>
        ) : null}

        {modoSimulado && emAberto ? (
          <form action={confirmar}>
            <input type="hidden" name="id" value={id} />
            <Botao type="submit" variante="secundario" tamanho="pequeno">
              Confirmar pagamento (simulado)
            </Botao>
          </form>
        ) : null}
      </div>

      <MensagemAcao
        estado={
          estadoCobranca.erro || estadoCobranca.sucesso
            ? estadoCobranca
            : estadoCancelar.erro || estadoCancelar.sucesso
              ? estadoCancelar
              : estadoSimulado
        }
      />

      {modoSimulado ? (
        <p className="text-xs text-[var(--color-texto-3)]">
          Gateway em modo simulação. A confirmação manual existe só para desenvolvimento — com um
          gateway real configurado, quem confirma o pagamento é o webhook.
        </p>
      ) : null}
    </div>
  );
}

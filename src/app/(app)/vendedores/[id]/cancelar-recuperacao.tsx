"use client";

import { useActionState, useState } from "react";
import { Badge, Botao, Campo, Entrada, Td, Tr } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoCancelarRecuperacao } from "../acoes";

export interface PeriodoRecuperacaoView {
  id: string;
  inicio: string;
  fim: string;
  motivo: string | null;
  registradoEm: string;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
}

/**
 * Linha do período, com o cancelamento aberto numa faixa abaixo dela.
 *
 * O formulário não cabe na célula de ações — e o que não cabe é justamente o
 * aviso que distingue cancelar de encerrar. Aviso cortado pela metade não
 * avisa; por isso a linha inteira se expande, em vez de espremer o texto numa
 * coluna estreita.
 */
export function LinhaRecuperacao({
  vendedorId,
  periodo,
  podeCancelar,
  colunas,
}: {
  vendedorId: string;
  periodo: PeriodoRecuperacaoView;
  podeCancelar: boolean;
  colunas: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(
    acaoCancelarRecuperacao,
    {},
  );

  return (
    <>
      <Tr>
        <Td className="whitespace-nowrap">{periodo.inicio}</Td>
        <Td className="whitespace-nowrap">{periodo.fim}</Td>
        <Td>
          {periodo.motivo ?? "—"}
          {periodo.canceladaEm ? (
            <span className="mt-1 block text-xs text-[var(--color-critico)]">
              Cancelado em {periodo.canceladaEm}
              {periodo.motivoCancelamento ? `: ${periodo.motivoCancelamento}` : ""}
            </span>
          ) : null}
        </Td>
        <Td className="whitespace-nowrap">{periodo.registradoEm}</Td>
        {podeCancelar ? (
          <Td>
            {periodo.canceladaEm ? (
              <Badge tom="neutro">Cancelado</Badge>
            ) : aberto ? (
              <Botao type="button" variante="secundario" onClick={() => setAberto(false)}>
                Voltar
              </Botao>
            ) : (
              <Botao type="button" variante="secundario" onClick={() => setAberto(true)}>
                Cancelar registro
              </Botao>
            )}
          </Td>
        ) : null}
      </Tr>

      {aberto && !periodo.canceladaEm ? (
        <tr className="bg-[var(--color-superficie-2)]">
          <td colSpan={colunas} className="px-4 py-4">
            <form action={despachar} className="flex flex-col gap-3">
              <input type="hidden" name="vendedorId" value={vendedorId} />
              <input type="hidden" name="recuperacaoId" value={periodo.id} />

              <MensagemAcao estado={estado} />

              <p className="max-w-3xl text-sm text-[var(--color-texto-2)]">
                Use isto só quando o registro <strong>não deveria existir</strong> — pessoa
                errada, datas erradas, lançamento indevido. As vendas que ele marcou são
                desmarcadas e os estornos calculados por causa dele são desfeitos.
              </p>
              <p className="max-w-3xl text-sm text-[var(--color-texto-2)]">
                Se a recuperação foi real e apenas terminou,{" "}
                <strong>não cancele</strong>: ela encerra sozinha na data de fim, e as vendas do
                período continuam sendo vendas feitas em recuperação.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <Campo
                  rotulo="Motivo do cancelamento"
                  dica="Obrigatório. Fica na auditoria."
                  className="min-w-80 flex-1"
                >
                  <Entrada
                    name="motivoCancelamento"
                    placeholder="Ex.: lançado no vendedor errado"
                    required
                  />
                </Campo>
                <BotaoAcao>Confirmar cancelamento</BotaoAcao>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

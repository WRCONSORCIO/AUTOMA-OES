"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Entrada } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoSalvarTabela, acaoSemear } from "./acoes";
import { PARCELAS_CONFIGURAVEIS } from "./constantes";

const PARCELAS = Array.from({ length: PARCELAS_CONFIGURAVEIS }, (_, i) => i + 1);

export interface TabelaEditavel {
  destino: string;
  destinoRotulo: string;
  segmento: string;
  segmentoRotulo: string;
  pago: boolean;
  faixas: { parcela: number; percentual: string }[];
}

/**
 * Um quadro por tabela: doze parcelas, cada uma com seu percentual.
 *
 * Parcela em branco não paga. É assim que se configura "gerência só na
 * primeira" ou "veterano pula a segunda" — sem exceção nenhuma no código.
 */
export function EditorTabela({ tabela }: { tabela: TabelaEditavel }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoSalvarTabela, {});

  const porParcela = new Map(tabela.faixas.map((faixa) => [faixa.parcela, faixa.percentual]));

  return (
    <form
      action={despachar}
      className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
    >
      <input type="hidden" name="destino" value={tabela.destino} />
      <input type="hidden" name="segmento" value={tabela.segmento} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="font-medium">
          {tabela.destinoRotulo} — {tabela.segmentoRotulo}
        </p>
        <Badge tom={tabela.pago ? "bom" : "neutro"}>
          {tabela.pago ? "A WR paga" : "Só para estorno"}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {PARCELAS.map((parcela) => (
          <label key={parcela} className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-texto-3)]">Parcela {parcela}</span>
            <Entrada
              name={`percentual_${parcela}`}
              inputMode="decimal"
              placeholder="—"
              defaultValue={porParcela.get(parcela) ?? ""}
              className="h-9 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <BotaoAcao variante="secundario">Salvar percentuais</BotaoAcao>
        <span className="text-xs text-[var(--color-texto-3)]">
          Parcela em branco não paga.
        </span>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}

export function BotaoSemear() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoSemear, {});

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao variante="secundario">
        <Sparkles className="h-4 w-4" />
        Criar tabelas que faltam
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

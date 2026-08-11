"use client";

import { useActionState } from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import { Badge, Entrada } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoAjustarVigencia, acaoSalvarTabela, acaoSemear } from "./acoes";
import { PARCELAS_CONFIGURAVEIS } from "./constantes";

const PARCELAS = Array.from({ length: PARCELAS_CONFIGURAVEIS }, (_, i) => i + 1);

export interface TabelaEditavel {
  destino: string;
  destinoRotulo: string;
  segmento: string;
  segmentoRotulo: string;
  pago: boolean;
  faixas: { parcela: number; percentual: string }[];
  /** Desde quando estes percentuais valem. Vazio = tabela ainda não criada. */
  vigenteDe: string | null;
  /** A vigência começa depois de vendas que já estão na base. */
  atrasada: boolean;
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
        {/*
          A vigência era invisível na tela, e é ela que decide se o percentual
          alcança as vendas já importadas. Percentual certo com vigência
          recente calcula zero, e não havia nada aqui que explicasse.
        */}
        {tabela.vigenteDe ? (
          <Badge tom={tabela.atrasada ? "critico" : "neutro"}>
            {tabela.atrasada ? "Só vale desde " : "Vale desde "}
            {tabela.vigenteDe}
          </Badge>
        ) : null}
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

/**
 * Recua a vigência dos percentuais até a venda mais antiga.
 *
 * Fica ao lado da carga inicial porque é o mesmo momento da vida do sistema:
 * acabou de configurar, e precisa que valha para o que já entrou.
 */
export function BotaoAjustarVigencia() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoAjustarVigencia, {});

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao variante="secundario">
        <CalendarClock className="h-4 w-4" />
        Aplicar às vendas já importadas
      </BotaoAcao>
      <span className="max-w-md text-xs text-[var(--color-texto-3)]">
        Recua a vigência até a venda mais antiga da base. Não altera nenhum percentual.
      </span>
      <MensagemAcao estado={estado} />
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

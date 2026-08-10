"use client";

import { useActionState, useState } from "react";
import { Badge, Botao, Campo, Entrada, Selecao } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoSalvarMeta } from "./metas-acoes";

export interface MetaView {
  id: string;
  categoriaAlvo: string;
  volumeMinimo: number;
  vigenteDe: string;
  vigenteAte: string | null;
  observacoes: string | null;
  vigente: boolean;
}

const hoje = () => new Date().toISOString().slice(0, 10);
const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Formulario({ meta, aoFechar }: { meta?: MetaView; aoFechar?: () => void }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoSalvarMeta, {});

  return (
    <form action={despachar} className="flex flex-col gap-4">
      <MensagemAcao estado={estado} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Degrau">
          <Selecao name="categoriaAlvo" defaultValue={meta?.categoriaAlvo ?? "VETERANO"} required>
            <option value="VETERANO">Iniciante → Veterano</option>
            <option value="EXPERT">Veterano → Expert</option>
          </Selecao>
        </Campo>

        <Campo
          rotulo="Volume da carteira"
          dica="Somando todos os documentos da pessoa."
        >
          <Entrada
            name="volumeMinimo"
            inputMode="decimal"
            defaultValue={meta ? String(meta.volumeMinimo).replace(".", ",") : ""}
            placeholder="3.000.000"
            required
          />
        </Campo>

        <Campo
          rotulo="Vigente a partir de"
          dica="Quem já foi promovido continua promovido."
        >
          <Entrada type="date" name="vigenteDe" defaultValue={hoje()} required />
        </Campo>
      </div>

      <Campo rotulo="Observação" dica="Opcional. Fica na auditoria.">
        <Entrada name="observacoes" placeholder="Motivo da alteração" />
      </Campo>

      <div className="flex gap-2">
        <BotaoAcao>{meta ? "Gravar nova vigência" : "Criar meta"}</BotaoAcao>
        {aoFechar ? (
          <Botao type="button" variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
        ) : null}
      </div>
    </form>
  );
}

export function LinhaMeta({ meta, podeEditar }: { meta: MetaView; podeEditar: boolean }) {
  const [editando, setEditando] = useState(false);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          {meta.categoriaAlvo === "VETERANO"
            ? "Iniciante → Veterano"
            : "Veterano → Expert"}
        </p>
        <Badge tom={meta.vigente ? "bom" : "neutro"}>
          {meta.vigente ? "Vigente" : "Encerrada"}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-[var(--color-texto-2)]">
        Promove ao atingir <strong>{moeda(meta.volumeMinimo)}</strong> vendidos na carteira
        completa. Abre um CNPJ novo.
      </p>

      <p className="mt-1 text-xs text-[var(--color-texto-3)]">
        Vigência: {meta.vigenteDe}
        {meta.vigenteAte ? ` até ${meta.vigenteAte}` : " — em aberto"}
        {meta.observacoes ? ` · ${meta.observacoes}` : ""}
      </p>

      {podeEditar && !editando ? (
        <div className="mt-3">
          <Botao type="button" variante="secundario" onClick={() => setEditando(true)}>
            Alterar
          </Botao>
        </div>
      ) : null}

      {editando ? (
        <div className="mt-4 border-t border-[var(--color-borda)] pt-4">
          <p className="mb-3 text-xs text-[var(--color-texto-3)]">
            Alterar encerra este período e abre um novo. Quem já foi promovido sob a meta
            antiga continua promovido — a promoção é um fato, não um cálculo.
          </p>
          <Formulario meta={meta} aoFechar={() => setEditando(false)} />
        </div>
      ) : null}
    </div>
  );
}

export function NovaMeta() {
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <Botao type="button" onClick={() => setAberto(true)}>
        Nova meta
      </Botao>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4">
      <p className="mb-3 font-medium">Nova meta de promoção</p>
      <Formulario aoFechar={() => setAberto(false)} />
    </div>
  );
}

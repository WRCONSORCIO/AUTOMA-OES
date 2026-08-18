"use client";

import { useActionState } from "react";
import { AreaTexto, Badge, Botao } from "@/components/ui";
import { MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoRestaurarMensagem, acaoSalvarMensagem } from "./acoes";

export interface ModeloLinha {
  chave: string;
  titulo: string;
  conteudo: string;
  descricao: string | null;
  variaveis: string[];
  temPadrao: boolean;
}

export function EditorMensagem({
  modelo,
  podeEditar,
}: {
  modelo: ModeloLinha;
  podeEditar: boolean;
}) {
  const [estadoSalvar, salvar] = useActionState<EstadoAcao, FormData>(acaoSalvarMensagem, {});
  const [estadoRestaurar, restaurar] = useActionState<EstadoAcao, FormData>(
    acaoRestaurarMensagem,
    {},
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{modelo.titulo}</h3>
          {modelo.descricao ? (
            <p className="text-xs text-[var(--color-texto-3)]">{modelo.descricao}</p>
          ) : null}
        </div>
        <Badge>{modelo.chave}</Badge>
      </div>

      {modelo.variaveis.length > 0 ? (
        <p className="mb-2 text-xs text-[var(--color-texto-3)]">
          Variáveis: {modelo.variaveis.map((nome) => `{{${nome}}}`).join(" · ")}
        </p>
      ) : null}

      <form action={salvar} className="flex flex-col gap-2">
        <MensagemAcao
          estado={
            estadoSalvar.erro || estadoSalvar.sucesso ? estadoSalvar : estadoRestaurar
          }
        />
        <input type="hidden" name="chave" value={modelo.chave} />
        <AreaTexto
          name="conteudo"
          defaultValue={modelo.conteudo}
          rows={4}
          disabled={!podeEditar}
          required
        />
        {podeEditar ? (
          <div className="flex gap-2">
            <Botao type="submit" tamanho="pequeno">
              Salvar
            </Botao>
            {modelo.temPadrao ? (
              <Botao
                type="submit"
                variante="sutil"
                tamanho="pequeno"
                formAction={restaurar}
                name="chave"
                value={modelo.chave}
              >
                Restaurar padrão
              </Botao>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}

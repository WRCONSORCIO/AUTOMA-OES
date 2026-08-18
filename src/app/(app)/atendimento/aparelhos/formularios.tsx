"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { AreaTexto, Badge, Botao, Campo, Entrada, Selecao, Td, Tr } from "@/components/ui";
import { FormularioAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoAlternarAparelho,
  acaoAtualizarAparelho,
  acaoCriarAparelho,
  acaoExcluirAparelho,
  acaoMoverAparelho,
} from "./acoes";

export interface AparelhoLinha {
  id: string;
  chave: string;
  nome: string;
  icone: string | null;
  status: string;
  ordem: number;
  fluxoId: string | null;
  fluxoNome: string | null;
  instrucoes: string | null;
  usadoEmFluxos: number;
}

export interface FluxoOpcao {
  id: string;
  nome: string;
}

export function NovoAparelho({ fluxos }: { fluxos: FluxoOpcao[] }) {
  return (
    <FormularioAcao acao={acaoCriarAparelho} rotuloBotao="Cadastrar aparelho">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Chave" dica="Identificador fixo. Ex.: tv_box">
          <Entrada name="chave" required pattern="[a-z0-9_]+" placeholder="tv_box" />
        </Campo>
        <CamposAparelho fluxos={fluxos} />
      </div>
    </FormularioAcao>
  );
}

function CamposAparelho({
  aparelho,
  fluxos,
}: {
  aparelho?: AparelhoLinha;
  fluxos: FluxoOpcao[];
}) {
  return (
    <>
      <Campo rotulo="Nome">
        <Entrada name="nome" required minLength={2} defaultValue={aparelho?.nome} placeholder="TV Box" />
      </Campo>
      <Campo rotulo="Ícone" dica="Um emoji">
        <Entrada name="icone" maxLength={8} defaultValue={aparelho?.icone ?? ""} placeholder="📦" />
      </Campo>
      <Campo rotulo="Status">
        <Selecao name="status" defaultValue={aparelho?.status ?? "ATIVO"}>
          <option value="ATIVO">Ativo</option>
          <option value="INATIVO">Inativo</option>
        </Selecao>
      </Campo>
      <Campo
        rotulo="Fluxo específico"
        dica="Sem fluxo, o bot envia as instruções abaixo"
        className="sm:col-span-2"
      >
        <Selecao name="fluxoId" defaultValue={aparelho?.fluxoId ?? ""}>
          <option value="">— Nenhum —</option>
          {fluxos.map((fluxo) => (
            <option key={fluxo.id} value={fluxo.id}>
              {fluxo.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Instruções" className="sm:col-span-2 lg:col-span-4">
        <AreaTexto name="instrucoes" rows={3} defaultValue={aparelho?.instrucoes ?? ""} />
      </Campo>
    </>
  );
}

export function LinhaAparelho({
  aparelho,
  fluxos,
  podeEditar,
  podeExcluir,
}: {
  aparelho: AparelhoLinha;
  fluxos: FluxoOpcao[];
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [estadoAtualizar, atualizar] = useActionState<EstadoAcao, FormData>(
    acaoAtualizarAparelho,
    {},
  );
  const [estadoAlternar, alternar] = useActionState<EstadoAcao, FormData>(acaoAlternarAparelho, {});
  const [estadoExcluir, excluir] = useActionState<EstadoAcao, FormData>(acaoExcluirAparelho, {});
  const [, mover] = useActionState<EstadoAcao, FormData>(acaoMoverAparelho, {});

  if (editando) {
    return (
      <Tr>
        <Td colSpan={6}>
          <form action={atualizar} className="flex flex-col gap-4">
            <MensagemAcao estado={estadoAtualizar} />
            <input type="hidden" name="id" value={aparelho.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <CamposAparelho aparelho={aparelho} fluxos={fluxos} />
            </div>
            <div className="flex gap-2">
              <Botao type="submit">Salvar</Botao>
              <Botao type="button" variante="secundario" onClick={() => setEditando(false)}>
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Botao>
            </div>
          </form>
        </Td>
      </Tr>
    );
  }

  return (
    <Tr>
      <Td className="font-medium">
        <span className="mr-2">{aparelho.icone}</span>
        {aparelho.nome}
        <div className="text-xs text-[var(--color-texto-3)]">{aparelho.chave}</div>
      </Td>
      <Td>
        {aparelho.fluxoNome ? (
          <Badge tom="marca">{aparelho.fluxoNome}</Badge>
        ) : (
          <span className="text-xs text-[var(--color-texto-3)]">Instruções diretas</span>
        )}
      </Td>
      <Td>
        <Badge tom={aparelho.status === "ATIVO" ? "bom" : "neutro"}>
          {aparelho.status === "ATIVO" ? "Ativo" : "Inativo"}
        </Badge>
      </Td>
      <Td className="numerico text-right">{aparelho.ordem + 1}</Td>
      <Td>
        {podeEditar ? (
          <div className="flex gap-1">
            <form action={mover}>
              <input type="hidden" name="id" value={aparelho.id} />
              <input type="hidden" name="direcao" value="cima" />
              <Botao type="submit" variante="sutil" tamanho="icone" aria-label="Subir">
                <ArrowUp className="h-3.5 w-3.5" />
              </Botao>
            </form>
            <form action={mover}>
              <input type="hidden" name="id" value={aparelho.id} />
              <input type="hidden" name="direcao" value="baixo" />
              <Botao type="submit" variante="sutil" tamanho="icone" aria-label="Descer">
                <ArrowDown className="h-3.5 w-3.5" />
              </Botao>
            </form>
          </div>
        ) : null}
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          {podeEditar ? (
            <>
              <Botao
                variante="secundario"
                tamanho="pequeno"
                type="button"
                onClick={() => setEditando(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Botao>
              <form action={alternar}>
                <input type="hidden" name="id" value={aparelho.id} />
                <Botao variante="sutil" tamanho="pequeno" type="submit">
                  {aparelho.status === "ATIVO" ? "Desativar" : "Ativar"}
                </Botao>
              </form>
            </>
          ) : null}
          {podeExcluir && aparelho.usadoEmFluxos === 0 ? (
            <form action={excluir}>
              <input type="hidden" name="id" value={aparelho.id} />
              <Botao variante="sutil" tamanho="pequeno" type="submit">
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </Botao>
            </form>
          ) : null}
          <MensagemAcao
            estado={estadoAlternar.erro || estadoAlternar.sucesso ? estadoAlternar : estadoExcluir}
          />
        </div>
      </Td>
    </Tr>
  );
}

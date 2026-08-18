"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { Badge, Botao, Campo, Entrada, AreaTexto, Selecao, Td, Tr } from "@/components/ui";
import { FormularioAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { formatarMoeda } from "@/lib/format";
import {
  acaoAlternarPlano,
  acaoAtualizarPlano,
  acaoCriarPlano,
  acaoExcluirPlano,
  acaoMoverPlano,
} from "./acoes";

export interface PlanoLinha {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoDias: number;
  preco: string;
  moeda: string;
  status: string;
  ordem: number;
  destaque: boolean;
  textoCliente: string | null;
  pedidos: number;
}

export function NovoPlano() {
  return (
    <FormularioAcao acao={acaoCriarPlano} rotuloBotao="Cadastrar plano">
      <CamposPlano />
    </FormularioAcao>
  );
}

function CamposPlano({ plano }: { plano?: PlanoLinha }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Campo rotulo="Nome">
        <Entrada name="nome" required minLength={2} defaultValue={plano?.nome} placeholder="Ex.: Plano 30 dias" />
      </Campo>
      <Campo rotulo="Duração (dias)">
        <Entrada
          name="duracaoDias"
          type="number"
          min={1}
          required
          defaultValue={plano?.duracaoDias ?? 30}
        />
      </Campo>
      <Campo rotulo="Preço" dica="Formato brasileiro: 99,90">
        <Entrada
          name="preco"
          required
          inputMode="decimal"
          defaultValue={plano ? formatarPreco(plano.preco) : ""}
          placeholder="0,00"
        />
      </Campo>
      <Campo rotulo="Moeda">
        <Entrada name="moeda" maxLength={3} defaultValue={plano?.moeda ?? "BRL"} />
      </Campo>
      <Campo rotulo="Status">
        <Selecao name="status" defaultValue={plano?.status ?? "ATIVO"}>
          <option value="ATIVO">Ativo</option>
          <option value="INATIVO">Inativo</option>
        </Selecao>
      </Campo>
      <Campo rotulo="Ordem" dica="Posição na lista enviada ao cliente">
        <Entrada name="ordem" type="number" min={0} defaultValue={plano?.ordem ?? 0} />
      </Campo>
      <Campo rotulo="Descrição" className="sm:col-span-2 lg:col-span-3">
        <Entrada name="descricao" defaultValue={plano?.descricao ?? ""} placeholder="Uso interno" />
      </Campo>
      <Campo
        rotulo="Texto exibido ao cliente"
        dica="Vazio: o bot monta com nome, duração e preço"
        className="sm:col-span-2 lg:col-span-3"
      >
        <AreaTexto name="textoCliente" defaultValue={plano?.textoCliente ?? ""} rows={2} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="destaque" defaultChecked={plano?.destaque} className="h-4 w-4" />
        Destacar este plano
      </label>
    </div>
  );
}

export function LinhaPlano({
  plano,
  podeEditar,
  podeExcluir,
}: {
  plano: PlanoLinha;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [estadoAlternar, alternar] = useActionState<EstadoAcao, FormData>(acaoAlternarPlano, {});
  const [estadoExcluir, excluir] = useActionState<EstadoAcao, FormData>(acaoExcluirPlano, {});
  const [, mover] = useActionState<EstadoAcao, FormData>(acaoMoverPlano, {});
  const [estadoAtualizar, atualizar] = useActionState<EstadoAcao, FormData>(acaoAtualizarPlano, {});

  if (editando) {
    return (
      <Tr>
        <Td colSpan={7}>
          <form action={atualizar} className="flex flex-col gap-4">
            <MensagemAcao estado={estadoAtualizar} />
            <input type="hidden" name="id" value={plano.id} />
            <CamposPlano plano={plano} />
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
        <div className="flex items-center gap-2">
          {plano.nome}
          {plano.destaque ? <Badge tom="marca">Destaque</Badge> : null}
        </div>
        {plano.descricao ? (
          <span className="text-xs text-[var(--color-texto-3)]">{plano.descricao}</span>
        ) : null}
      </Td>
      <Td className="numerico text-right">{plano.duracaoDias} dias</Td>
      <Td className="numerico text-right">{formatarMoeda(Number(plano.preco))}</Td>
      <Td className="numerico text-right">{plano.pedidos}</Td>
      <Td>
        <Badge tom={plano.status === "ATIVO" ? "bom" : "neutro"}>
          {plano.status === "ATIVO" ? "Ativo" : "Inativo"}
        </Badge>
      </Td>
      <Td>
        {podeEditar ? (
          <div className="flex gap-1">
            <form action={mover}>
              <input type="hidden" name="id" value={plano.id} />
              <input type="hidden" name="direcao" value="cima" />
              <Botao type="submit" variante="sutil" tamanho="icone" aria-label="Subir">
                <ArrowUp className="h-3.5 w-3.5" />
              </Botao>
            </form>
            <form action={mover}>
              <input type="hidden" name="id" value={plano.id} />
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
                <input type="hidden" name="id" value={plano.id} />
                <Botao variante="sutil" tamanho="pequeno" type="submit">
                  {plano.status === "ATIVO" ? "Desativar" : "Ativar"}
                </Botao>
              </form>
            </>
          ) : null}
          {podeExcluir && plano.pedidos === 0 ? (
            <form action={excluir}>
              <input type="hidden" name="id" value={plano.id} />
              <Botao variante="sutil" tamanho="pequeno" type="submit">
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </Botao>
            </form>
          ) : null}
          <MensagemAcao estado={estadoAlternar.erro || estadoAlternar.sucesso ? estadoAlternar : estadoExcluir} />
        </div>
      </Td>
    </Tr>
  );
}

function formatarPreco(preco: string): string {
  return Number(preco).toFixed(2).replace(".", ",");
}

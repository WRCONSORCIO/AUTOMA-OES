"use client";

import { useActionState, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { formatarNumero } from "@/lib/format";
import { Badge, Botao, Campo, Entrada, Selecao, Td, Tr } from "@/components/ui";
import { FormularioAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoAtualizarEquipe, acaoCriarEquipe } from "../estrutura-acoes";

type Gerencia = { id: string; nome: string };

export function FormularioEquipe({ gerencias }: { gerencias: Gerencia[] }) {
  return (
    <FormularioAcao acao={acaoCriarEquipe} rotuloBotao="Cadastrar equipe">
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Nome">
          <Entrada name="nome" required minLength={2} placeholder="Ex.: Equipe Nikson" />
        </Campo>
        <Campo rotulo="Gerência">
          <Selecao name="gerenciaId" required defaultValue="">
            <option value="" disabled>
              Selecione…
            </option>
            {gerencias.map((gerencia) => (
              <option key={gerencia.id} value={gerencia.id}>
                {gerencia.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Status">
          <Selecao name="status" defaultValue="ATIVO">
            <option value="ATIVO">Ativo</option>
            <option value="INATIVO">Inativo</option>
          </Selecao>
        </Campo>
      </div>
    </FormularioAcao>
  );
}

interface Equipe {
  id: string;
  nome: string;
  status: string;
  gerenciaId: string;
  gerenciaNome: string;
  vendedores: number;
  cotas: number;
}

export function LinhaEquipe({
  equipe,
  gerencias,
}: {
  equipe: Equipe;
  gerencias: Gerencia[];
}) {
  const [editando, setEditando] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoAtualizarEquipe, {});

  if (!editando) {
    return (
      <Tr>
        <Td className="font-medium">{equipe.nome}</Td>
        <Td>{equipe.gerenciaNome}</Td>
        <Td>
          <Badge tom={equipe.status === "ATIVO" ? "bom" : "neutro"}>{equipe.status}</Badge>
        </Td>
        <Td className="numerico text-right">{formatarNumero(equipe.vendedores)}</Td>
        <Td className="numerico text-right">{formatarNumero(equipe.cotas)}</Td>
        <Td>
          <div className="flex items-center gap-2">
            <Botao
              variante="secundario"
              tamanho="pequeno"
              type="button"
              onClick={() => setEditando(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </Botao>
            <MensagemAcao estado={estado} />
          </div>
        </Td>
      </Tr>
    );
  }

  return (
    <Tr>
      <Td colSpan={6}>
        <form action={despachar} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={equipe.id} />
          <Campo rotulo="Nome" className="min-w-52 flex-1">
            <Entrada name="nome" defaultValue={equipe.nome} required minLength={2} />
          </Campo>
          <Campo rotulo="Gerência" className="w-52">
            <Selecao name="gerenciaId" defaultValue={equipe.gerenciaId}>
              {gerencias.map((gerencia) => (
                <option key={gerencia.id} value={gerencia.id}>
                  {gerencia.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Status" className="w-40">
            <Selecao name="status" defaultValue={equipe.status}>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </Selecao>
          </Campo>
          <Botao type="submit" tamanho="pequeno">
            <Check className="h-3.5 w-3.5" />
            Salvar
          </Botao>
          <Botao
            variante="secundario"
            tamanho="pequeno"
            type="button"
            onClick={() => setEditando(false)}
          >
            <X className="h-3.5 w-3.5" />
            Cancelar
          </Botao>
        </form>
      </Td>
    </Tr>
  );
}

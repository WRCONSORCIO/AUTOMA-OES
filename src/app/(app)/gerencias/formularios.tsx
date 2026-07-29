"use client";

import { useActionState, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { formatarNumero } from "@/lib/format";
import { Badge, Botao, Campo, Entrada, Selecao, Td, Tr } from "@/components/ui";
import { FormularioAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoAtualizarGerencia, acaoCriarGerencia } from "../estrutura-acoes";

export function FormularioGerencia() {
  return (
    <FormularioAcao acao={acaoCriarGerencia} rotuloBotao="Cadastrar gerência">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome">
          <Entrada name="nome" required minLength={2} placeholder="Ex.: Gerência Rafael" />
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

interface Gerencia {
  id: string;
  nome: string;
  status: string;
  equipes: number;
  vendedores: number;
  cotas: number;
}

export function LinhaGerencia({ gerencia }: { gerencia: Gerencia }) {
  const [editando, setEditando] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoAtualizarGerencia, {});

  if (!editando) {
    return (
      <Tr>
        <Td className="font-medium">{gerencia.nome}</Td>
        <Td>
          <Badge tom={gerencia.status === "ATIVO" ? "bom" : "neutro"}>{gerencia.status}</Badge>
        </Td>
        <Td className="numerico text-right">{formatarNumero(gerencia.equipes)}</Td>
        <Td className="numerico text-right">{formatarNumero(gerencia.vendedores)}</Td>
        <Td className="numerico text-right">{formatarNumero(gerencia.cotas)}</Td>
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
          <input type="hidden" name="id" value={gerencia.id} />
          <Campo rotulo="Nome" className="min-w-56 flex-1">
            <Entrada name="nome" defaultValue={gerencia.nome} required minLength={2} />
          </Campo>
          <Campo rotulo="Status" className="w-40">
            <Selecao name="status" defaultValue={gerencia.status}>
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

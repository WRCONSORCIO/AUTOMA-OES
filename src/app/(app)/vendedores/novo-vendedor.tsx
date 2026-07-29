"use client";

import { useState } from "react";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { FormularioAcao } from "@/components/formulario-acao";
import { acaoCriarVendedor } from "./acoes";

interface Equipe {
  id: string;
  nome: string;
  gerencia: { id: string; nome: string };
}

export function NovoVendedor({
  equipes,
  gerencias,
}: {
  equipes: Equipe[];
  gerencias: { id: string; nome: string }[];
}) {
  const [gerenciaId, setGerenciaId] = useState("");

  // Cada equipe pertence a uma única gerência: selecionar a equipe define a gerência.
  const equipesFiltradas = gerenciaId
    ? equipes.filter((equipe) => equipe.gerencia.id === gerenciaId)
    : equipes;

  return (
    <FormularioAcao acao={acaoCriarVendedor} rotuloBotao="Cadastrar vendedor">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Nome" className="sm:col-span-2">
          <Entrada name="nome" required minLength={3} />
        </Campo>

        <Campo rotulo="CPF/CNPJ">
          <Entrada name="cpfCnpj" required placeholder="000.000.000-00" />
        </Campo>

        <Campo rotulo="Gerência">
          <Selecao
            name="gerenciaId"
            value={gerenciaId}
            onChange={(evento) => setGerenciaId(evento.target.value)}
          >
            <option value="">Sem gerência</option>
            {gerencias.map((gerencia) => (
              <option key={gerencia.id} value={gerencia.id}>
                {gerencia.nome}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo rotulo="Equipe">
          <Selecao name="equipeId" defaultValue="">
            <option value="">Sem equipe</option>
            {equipesFiltradas.map((equipe) => (
              <option key={equipe.id} value={equipe.id}>
                {equipe.nome} · {equipe.gerencia.nome}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo
          rotulo="Categoria atual"
          dica="Abre o primeiro período do histórico de categoria."
        >
          <Selecao name="categoriaAtual" defaultValue="INICIANTE">
            <option value="INICIANTE">Iniciante</option>
            <option value="VETERANO">Veterano</option>
            <option value="EXPERT">Expert</option>
          </Selecao>
        </Campo>

        <Campo rotulo="Data de entrada na WR">
          <Entrada type="date" name="dataEntradaWr" />
        </Campo>

        <Campo rotulo="Situação">
          <Selecao name="situacao" defaultValue="ATIVO">
            <option value="ATIVO">Ativo</option>
            <option value="AFASTADO">Afastado</option>
            <option value="INATIVO">Inativo</option>
            <option value="DESLIGADO">Desligado</option>
          </Selecao>
        </Campo>

        <Campo rotulo="Observações" className="sm:col-span-2 lg:col-span-3">
          <AreaTexto name="observacoes" rows={2} />
        </Campo>
      </div>
    </FormularioAcao>
  );
}

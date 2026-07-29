"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AreaTexto, Campo, Card, CardContent, Entrada, Selecao } from "@/components/ui";
import { FormularioAcao } from "@/components/formulario-acao";
import {
  acaoAlterarAlocacao,
  acaoAlterarCategoria,
  acaoAtualizarVendedor,
  acaoRegistrarRecuperacao,
} from "../acoes";

interface Vendedor {
  id: string;
  nome: string;
  situacao: string;
  observacoes: string | null;
  dataEntradaWr: string;
  equipeId: string | null;
  gerenciaId: string | null;
  categoriaAtual: string;
}

interface Equipe {
  id: string;
  nome: string;
  gerencia: { id: string; nome: string };
}

const ABAS = [
  { chave: "cadastro", rotulo: "Cadastro" },
  { chave: "categoria", rotulo: "Alterar categoria" },
  { chave: "alocacao", rotulo: "Equipe e gerência" },
  { chave: "recuperacao", rotulo: "Recuperação" },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

export function PainelVendedor({
  vendedor,
  equipes,
  gerencias,
}: {
  vendedor: Vendedor;
  equipes: Equipe[];
  gerencias: { id: string; nome: string }[];
}) {
  const [aba, setAba] = useState<Aba>("cadastro");
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-borda)] p-2">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={() => setAba(item.chave)}
            aria-pressed={aba === item.chave}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              aba === item.chave
                ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
            )}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      <CardContent>
        {aba === "cadastro" ? (
          <FormularioAcao acao={acaoAtualizarVendedor} rotuloBotao="Salvar cadastro">
            <input type="hidden" name="id" value={vendedor.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Nome" className="sm:col-span-2">
                <Entrada name="nome" defaultValue={vendedor.nome} required minLength={3} />
              </Campo>
              <Campo rotulo="Situação">
                <Selecao name="situacao" defaultValue={vendedor.situacao}>
                  <option value="ATIVO">Ativo</option>
                  <option value="AFASTADO">Afastado</option>
                  <option value="INATIVO">Inativo</option>
                  <option value="DESLIGADO">Desligado</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Data de entrada na WR">
                <Entrada type="date" name="dataEntradaWr" defaultValue={vendedor.dataEntradaWr} />
              </Campo>
              <Campo rotulo="Observações" className="sm:col-span-2 lg:col-span-3">
                <AreaTexto name="observacoes" defaultValue={vendedor.observacoes ?? ""} rows={3} />
              </Campo>
            </div>
          </FormularioAcao>
        ) : null}

        {aba === "categoria" ? (
          <FormularioAcao acao={acaoAlterarCategoria} rotuloBotao="Registrar nova categoria">
            <input type="hidden" name="id" value={vendedor.id} />
            <p className="text-sm text-[var(--color-texto-2)]">
              O período anterior é encerrado no dia antes da nova vigência e permanece no
              histórico. Vendas já realizadas continuam usando a categoria da data em que foram
              feitas.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Nova categoria">
                <Selecao name="categoria" defaultValue={vendedor.categoriaAtual}>
                  <option value="INICIANTE">Iniciante</option>
                  <option value="VETERANO">Veterano</option>
                  <option value="EXPERT">Expert</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Vigente a partir de">
                <Entrada type="date" name="vigenteDe" defaultValue={hoje} required />
              </Campo>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" placeholder="Ex.: promoção por desempenho" />
              </Campo>
            </div>
          </FormularioAcao>
        ) : null}

        {aba === "alocacao" ? (
          <FormularioAcao acao={acaoAlterarAlocacao} rotuloBotao="Atualizar alocação">
            <input type="hidden" name="id" value={vendedor.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Gerência">
                <Selecao name="gerenciaId" defaultValue={vendedor.gerenciaId ?? ""}>
                  <option value="">Sem gerência</option>
                  {gerencias.map((gerencia) => (
                    <option key={gerencia.id} value={gerencia.id}>
                      {gerencia.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Equipe">
                <Selecao name="equipeId" defaultValue={vendedor.equipeId ?? ""}>
                  <option value="">Sem equipe</option>
                  {equipes.map((equipe) => (
                    <option key={equipe.id} value={equipe.id}>
                      {equipe.nome} · {equipe.gerencia.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Vigente a partir de">
                <Entrada type="date" name="vigenteDe" defaultValue={hoje} />
              </Campo>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" placeholder="Ex.: mudança de equipe" />
              </Campo>
            </div>
          </FormularioAcao>
        ) : null}

        {aba === "recuperacao" ? (
          <FormularioAcao acao={acaoRegistrarRecuperacao} rotuloBotao="Registrar recuperação">
            <input type="hidden" name="id" value={vendedor.id} />
            <p className="text-sm text-[var(--color-texto-2)]">
              Toda venda com data dentro do intervalo será marcada permanentemente. Se uma dessas
              vendas cancelar antes da 6ª parcela — mesmo anos depois — o estorno é gerado.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Data de início">
                <Entrada type="date" name="dataInicio" required />
              </Campo>
              <Campo rotulo="Data de fim">
                <Entrada type="date" name="dataFim" required />
              </Campo>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" placeholder="Ex.: plano de recuperação comercial" />
              </Campo>
            </div>
          </FormularioAcao>
        ) : null}
      </CardContent>
    </Card>
  );
}

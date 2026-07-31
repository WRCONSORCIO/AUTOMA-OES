"use client";

import { useActionState, useState } from "react";
import { Pencil, Power, Trash2 } from "lucide-react";
import { Botao, Campo, Entrada, Selecao } from "@/components/ui";
import {
  BotaoAcao,
  FormularioAcao,
  MensagemAcao,
  type EstadoAcao,
} from "@/components/formulario-acao";
import {
  acaoAlternarEquipeHabilitada,
  acaoAlternarModalidade,
  acaoCriarModalidadeFlex,
  acaoCriarTabela,
  acaoCriarTabelaEquipe,
  acaoEditarTabela,
  acaoRemoverTabela,
  acaoRemoverTabelaEquipe,
} from "./acoes";

/** Vazio = vale para todos os segmentos. */
function CampoSegmento({ valor }: { valor?: string | null }) {
  return (
    <Campo rotulo="Segmento" dica="Deixe em Todos quando a comissão não muda por produto.">
      <Selecao name="segmento" defaultValue={valor ?? ""}>
        <option value="">Todos os segmentos</option>
        <option value="IMOVEL">Imóvel</option>
        <option value="AUTOMOVEL">Automóvel</option>
      </Selecao>
    </Campo>
  );
}

const PARCELAS = Array.from({ length: 12 }, (_, indice) => indice + 1);

const PAPEIS = [
  {
    papel: "VENDEDOR",
    rotulo: "Vendedor",
    dica: "Quem fez a venda.",
  },
  {
    papel: "SUPERVISOR",
    rotulo: "Supervisão",
    dica: "A equipe do vendedor na data da venda.",
  },
  {
    papel: "GERENCIA",
    rotulo: "Gerência",
    dica: "A gerência da venda.",
  },
] as const;

export function FormularioTabela() {
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <FormularioAcao acao={acaoCriarTabela} rotuloBotao="Criar tabela">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Nome da tabela">
          <Entrada name="nome" required minLength={2} placeholder="Ex.: Expert imóvel 2026" />
        </Campo>
        <Campo rotulo="Categoria">
          <Selecao name="categoria" defaultValue="INICIANTE">
            <option value="INICIANTE">Iniciante</option>
            <option value="VETERANO">Veterano</option>
            <option value="EXPERT">Expert</option>
          </Selecao>
        </Campo>
        <CampoSegmento />
        <Campo rotulo="Vigente a partir de">
          <Entrada type="date" name="vigenteDe" defaultValue={hoje} required />
        </Campo>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-[var(--color-texto-2)]">
          Percentual por parcela (deixe em branco para não gerar comissão)
        </legend>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {PARCELAS.map((parcela) => (
            <label key={parcela} className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-texto-3)]">Parcela {parcela}</span>
              <Entrada
                name={`percentual_${parcela}`}
                inputMode="decimal"
                placeholder="0,00"
                className="h-9 text-sm"
              />
            </label>
          ))}
        </div>
      </fieldset>
    </FormularioAcao>
  );
}

export function FormularioTabelaEquipe() {
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <FormularioAcao acao={acaoCriarTabelaEquipe} rotuloBotao="Criar tabela e apurar">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Nome da tabela">
          <Entrada name="nome" required minLength={2} placeholder="Ex.: Equipe Veterano 2026" />
        </Campo>
        <Campo rotulo="Categoria da venda">
          <Selecao name="categoria" defaultValue="INICIANTE">
            <option value="INICIANTE">Iniciante</option>
            <option value="VETERANO">Veterano</option>
            <option value="EXPERT">Expert</option>
          </Selecao>
        </Campo>
        <CampoSegmento />
        <Campo rotulo="Vigente a partir de">
          <Entrada type="date" name="vigenteDe" defaultValue={hoje} required />
        </Campo>
        <Campo
          rotulo="Parcelas para liberar"
          dica="1 libera tudo no primeiro recebimento da administradora."
        >
          <Entrada type="number" name="parcelasParaLiberacao" defaultValue="1" min={1} max={12} />
        </Campo>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-[var(--color-texto-2)]">
          Percentual sobre a base da venda (crédito × flex). Deixe em branco para não pagar.
        </legend>
        <div className="grid gap-4 lg:grid-cols-3">
          {PAPEIS.map((item) => (
            <div
              key={item.papel}
              className="rounded-lg border border-[var(--color-borda)] p-3"
            >
              <p className="text-sm font-medium">{item.rotulo}</p>
              <p className="mt-0.5 text-xs text-[var(--color-texto-3)]">{item.dica}</p>
              <div className="mt-3 flex flex-col gap-3">
                <Campo rotulo="Percentual">
                  <Entrada
                    name={`percentual_${item.papel}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="h-9 text-sm"
                  />
                </Campo>
                <Campo rotulo="Quando aplica">
                  <Selecao
                    name={`condicao_${item.papel}`}
                    defaultValue="SEMPRE"
                    className="h-9 text-sm"
                  >
                    <option value="SEMPRE">Sempre</option>
                    <option value="SUPERVISAO_DIFERENTE_GERENCIA">
                      Só quando a supervisão não é o gerente
                    </option>
                    <option value="EQUIPE_HABILITADA">Só nas equipes marcadas</option>
                  </Selecao>
                </Campo>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
    </FormularioAcao>
  );
}

export function BotaoAlternarEquipe({ id, habilitada }: { id: string; habilitada: boolean }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(
    acaoAlternarEquipeHabilitada,
    {},
  );

  return (
    <form action={despachar} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <BotaoAcao variante="secundario">
        <Power className="h-3.5 w-3.5" />
        {habilitada ? "Desmarcar" : "Marcar"}
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

export function FormularioFlex() {
  return (
    <FormularioAcao acao={acaoCriarModalidadeFlex} rotuloBotao="Cadastrar modalidade">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome">
          <Entrada name="nome" required minLength={2} placeholder="Ex.: Flex 50" />
        </Campo>
        <Campo rotulo="Percentual da base" dica="100 para integral, 50 para metade do crédito.">
          <Entrada name="percentual" required inputMode="decimal" placeholder="50" />
        </Campo>
      </div>
    </FormularioAcao>
  );
}

export function BotaoAlternarFlex({ id, ativo }: { id: string; ativo: boolean }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoAlternarModalidade, {});

  return (
    <form action={despachar} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <BotaoAcao variante="secundario">
        <Power className="h-3.5 w-3.5" />
        {ativo ? "Inativar" : "Reativar"}
      </BotaoAcao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

interface TabelaEditavel {
  id: string;
  nome: string;
  segmento: string | null;
  vigenteDe: string;
  vigenteAte: string | null;
  faixas: { parcela: number; percentual: string }[];
}

/**
 * Corrige a tabela no lugar. Existe para o caso de ela ter sido cadastrada
 * errada — quando o percentual muda de verdade a partir de uma data, o certo é
 * criar uma vigência nova acima.
 */
export function EditarTabela({ tabela }: { tabela: TabelaEditavel }) {
  const [aberto, setAberto] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoEditarTabela, {});

  const porParcela = new Map(tabela.faixas.map((faixa) => [faixa.parcela, faixa.percentual]));

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="secundario" tamanho="pequeno" type="button" onClick={() => setAberto(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Corrigir
        </Botao>
        <RemoverTabela id={tabela.id} nome={tabela.nome} />
      </div>
    );
  }

  return (
    <form
      action={despachar}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-3)] p-3"
    >
      <input type="hidden" name="id" value={tabela.id} />

      <p className="text-xs text-[var(--color-texto-2)]">
        Corrigir reescreve a tabela e recalcula o que já foi apurado com ela. Para uma mudança
        real de percentual a partir de uma data, crie uma tabela nova em vez de corrigir esta.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Nome">
          <Entrada name="nome" defaultValue={tabela.nome} required minLength={2} className="h-9 text-sm" />
        </Campo>
        <CampoSegmento valor={tabela.segmento} />
        <Campo rotulo="Vigente de">
          <Entrada type="date" name="vigenteDe" defaultValue={tabela.vigenteDe} required className="h-9 text-sm" />
        </Campo>
        <Campo rotulo="Vigente até" dica="Em branco = ainda vigente.">
          <Entrada type="date" name="vigenteAte" defaultValue={tabela.vigenteAte ?? ""} className="h-9 text-sm" />
        </Campo>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {PARCELAS.map((parcela) => (
          <label key={parcela} className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-texto-3)]">Parcela {parcela}</span>
            <Entrada
              name={`percentual_${parcela}`}
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={porParcela.get(parcela) ?? ""}
              className="h-9 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BotaoAcao>Salvar e recalcular</BotaoAcao>
        <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}

export function RemoverTabela({ id, nome }: { id: string; nome: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoRemoverTabela, {});

  if (!confirmando) {
    return (
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setConfirmando(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </Botao>
    );
  }

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-[var(--color-texto-2)]">Excluir “{nome}”?</span>
      <BotaoAcao>Confirmar</BotaoAcao>
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setConfirmando(false)}>
        Cancelar
      </Botao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

export function RemoverTabelaEquipe({ id, nome }: { id: string; nome: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoRemoverTabelaEquipe, {});

  if (!confirmando) {
    return (
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setConfirmando(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </Botao>
    );
  }

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-[var(--color-texto-2)]">Excluir “{nome}”?</span>
      <BotaoAcao>Confirmar</BotaoAcao>
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setConfirmando(false)}>
        Cancelar
      </Botao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

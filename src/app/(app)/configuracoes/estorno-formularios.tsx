"use client";

import { useActionState, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge, Botao, Campo, Entrada, Selecao } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoAjustarVigenciaDasRegras,
  acaoEncerrarRegraEstorno,
  acaoSalvarRegraEstorno,
} from "./estorno-acoes";

export interface RegraEstornoView {
  id: string;
  tipo: "CANCELAMENTO" | "RECUPERACAO";
  categoriasVenda: string[];
  vendedorId: string | null;
  vendedorNome: string | null;
  parcelaLimite: number;
  percentual: number;
  vigenteDe: string;
  vigenteAte: string | null;
  observacoes: string | null;
  vigente: boolean;
}

export interface OpcaoVendedor {
  id: string;
  nome: string;
}

const ROTULO_TIPO: Record<string, string> = {
  RECUPERACAO: "Venda em recuperação",
  CANCELAMENTO: "Cancelamento",
};

const CATEGORIAS = [
  { valor: "INICIANTE", rotulo: "Iniciante" },
  { valor: "VETERANO", rotulo: "Veterano" },
  { valor: "EXPERT", rotulo: "Expert" },
] as const;

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Formulário de regra.
 *
 * Alterar não sobrescreve: grava um período novo a partir da data informada e
 * encerra o anterior. Por isso o campo de vigência é obrigatório e vem sempre
 * preenchido com hoje — quem altera precisa dizer a partir de quando vale.
 */
export function FormularioRegraEstorno({
  vendedores,
  regra,
  aoFechar,
}: {
  vendedores: OpcaoVendedor[];
  regra?: RegraEstornoView;
  aoFechar?: () => void;
}) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(
    acaoSalvarRegraEstorno,
    {},
  );

  return (
    <form action={despachar} className="flex flex-col gap-4">
      <MensagemAcao estado={estado} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Situação">
          <Selecao name="tipo" defaultValue={regra?.tipo ?? "RECUPERACAO"} required>
            <option value="RECUPERACAO">Venda em recuperação</option>
            <option value="CANCELAMENTO">Cancelamento</option>
          </Selecao>
        </Campo>

        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="font-medium">Categorias da venda</legend>
          <p className="text-xs text-[var(--color-texto-3)]">
            Nenhuma marcada vale para todas.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {CATEGORIAS.map((categoria) => (
              <label key={categoria.valor} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="categoriasVenda"
                  value={categoria.valor}
                  defaultChecked={regra?.categoriasVenda.includes(categoria.valor)}
                  className="size-4 accent-[var(--color-marca)]"
                />
                {categoria.rotulo}
              </label>
            ))}
          </div>
        </fieldset>

        <Campo
          rotulo="Vendedor"
          dica="Vazio = regra padrão da WR. A regra do vendedor vence a padrão."
        >
          <Selecao name="vendedorId" defaultValue={regra?.vendedorId ?? ""}>
            <option value="">Padrão da WR</option>
            {vendedores.map((vendedor) => (
              <option key={vendedor.id} value={vendedor.id}>
                {vendedor.nome}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo
          rotulo="Percentual (%)"
          dica="Sobre a comissão recebida na venda."
        >
          <Entrada
            name="percentual"
            inputMode="decimal"
            defaultValue={regra ? String(regra.percentual).replace(".", ",") : "50"}
            placeholder="50"
            required
          />
        </Campo>

        <Campo
          rotulo="Estorna abaixo de"
          dica="Parcelas pagas. Zero desliga o estorno neste caso."
        >
          <Entrada
            name="parcelaLimite"
            inputMode="numeric"
            defaultValue={regra ? String(regra.parcelaLimite) : "6"}
            placeholder="6"
            required
          />
        </Campo>

        <Campo
          rotulo="Vigente a partir de"
          dica="Cancelamentos anteriores continuam com a regra antiga."
        >
          <Entrada type="date" name="vigenteDe" defaultValue={hoje()} required />
        </Campo>
      </div>

      <Campo rotulo="Observação" dica="Opcional. Fica registrado na auditoria.">
        <Entrada name="observacoes" placeholder="Motivo da alteração" />
      </Campo>

      <div className="flex gap-2">
        <BotaoAcao>{regra ? "Gravar nova vigência" : "Criar regra"}</BotaoAcao>
        {aoFechar ? (
          <Botao type="button" variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
        ) : null}
      </div>
    </form>
  );
}

function FormularioEncerrar({ id }: { id: string }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(
    acaoEncerrarRegraEstorno,
    {},
  );

  return (
    <form action={despachar} className="flex flex-col gap-2">
      <MensagemAcao estado={estado} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="em" value={hoje()} />
      <BotaoAcao variante="secundario">Encerrar hoje</BotaoAcao>
    </form>
  );
}

/** Uma regra na lista, com a opção de abrir nova vigência ou encerrar. */
export function LinhaRegraEstorno({
  regra,
  vendedores,
  podeEditar,
}: {
  regra: RegraEstornoView;
  vendedores: OpcaoVendedor[];
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{ROTULO_TIPO[regra.tipo] ?? regra.tipo}</p>
        <Badge tom={regra.vigente ? "bom" : "neutro"}>
          {regra.vigente ? "Vigente" : "Encerrada"}
        </Badge>
        <Badge tom="neutro">
          {regra.categoriasVenda.length > 0
            ? regra.categoriasVenda.join(" + ")
            : "Todas as categorias"}
        </Badge>
        <Badge tom={regra.vendedorId ? "atencao" : "neutro"}>
          {regra.vendedorNome ?? "Padrão da WR"}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-[var(--color-texto-2)]">
        {regra.parcelaLimite === 0 ? (
          <>Estorno desligado para este caso.</>
        ) : (
          <>
            Estorna <strong>{String(regra.percentual).replace(".", ",")}%</strong> da
            comissão quando o cancelamento ocorre com menos de{" "}
            <strong>{regra.parcelaLimite}</strong> parcela(s) paga(s).
          </>
        )}
      </p>

      <p className="mt-1 text-xs text-[var(--color-texto-3)]">
        Vigência: {regra.vigenteDe}
        {regra.vigenteAte ? ` até ${regra.vigenteAte}` : " — em aberto"}
        {regra.observacoes ? ` · ${regra.observacoes}` : ""}
      </p>

      {podeEditar ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {editando ? null : (
            <Botao type="button" variante="secundario" onClick={() => setEditando(true)}>
              Alterar
            </Botao>
          )}
          {regra.vigente && !regra.vigenteAte ? <FormularioEncerrar id={regra.id} /> : null}
        </div>
      ) : null}

      {editando ? (
        <div className="mt-4 border-t border-[var(--color-borda)] pt-4">
          <p className="mb-3 text-xs text-[var(--color-texto-3)]">
            Alterar encerra este período e abre um novo. O que já foi apurado com a
            regra antiga permanece como está.
          </p>
          <FormularioRegraEstorno
            vendedores={vendedores}
            regra={regra}
            aoFechar={() => setEditando(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Bloco de criação, recolhido por padrão para não competir com a lista. */
export function NovaRegraEstorno({ vendedores }: { vendedores: OpcaoVendedor[] }) {
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <Botao type="button" onClick={() => setAberto(true)}>
        Nova regra
      </Botao>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4">
      <p className="mb-3 font-medium">Nova regra de estorno</p>
      <FormularioRegraEstorno vendedores={vendedores} aoFechar={() => setAberto(false)} />
    </div>
  );
}

/**
 * Recua a vigência das regras de estorno até a venda mais antiga.
 *
 * Mesmo problema dos percentuais de comissão, e mesma solução: a tela pede uma
 * data de vigência, mas quem cadastra a regra depois de já ter importado a base
 * — que é a ordem natural — põe a data de hoje sem perceber que, com isso, a
 * regra não alcança cancelamento nenhum do histórico.
 */
export function BotaoAjustarVigenciaDasRegras() {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(
    acaoAjustarVigenciaDasRegras,
    {},
  );

  return (
    <form action={despachar} className="flex flex-wrap items-center gap-3">
      <BotaoAcao variante="secundario">
        <CalendarClock className="h-4 w-4" />
        Aplicar aos cancelamentos já importados
      </BotaoAcao>
      <span className="max-w-md text-xs text-[var(--color-texto-3)]">
        Recua a vigência até a venda mais antiga da base. Não altera percentual nem limite de
        parcelas.
      </span>
      <MensagemAcao estado={estado} />
    </form>
  );
}

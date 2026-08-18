"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { AreaTexto, Badge, Botao, Campo, Entrada, Selecao } from "@/components/ui";
import { FormularioAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoAtualizarEtapa,
  acaoAtualizarFluxo,
  acaoAtualizarOpcao,
  acaoCriarEtapa,
  acaoCriarOpcao,
  acaoExcluirEtapa,
  acaoExcluirFluxo,
  acaoExcluirOpcao,
  acaoMoverEtapa,
} from "../acoes";
import { ROTULO_TIPO_FLUXO } from "../formularios";

export const TIPOS_ETAPA = [
  ["TEXT", "Texto — envia e segue para a próxima"],
  ["MENU", "Menu numerado"],
  ["BUTTONS", "Botões (até 3, com fallback)"],
  ["LIST", "Lista (até 10, com fallback)"],
  ["INPUT", "Pergunta aberta — guarda a resposta"],
  ["PAYMENT", "Pagamento — cria a cobrança"],
  ["PAYMENT_STATUS", "Espera do pagamento"],
  ["DEVICE_SELECTION", "Escolha do aparelho"],
  ["HUMAN_HANDOFF", "Transferir para atendente"],
  ["END", "Encerramento"],
] as const;

export interface OpcaoLinha {
  id: string;
  rotulo: string;
  valor: string;
  ativo: boolean;
  proximaEtapaId: string | null;
  proximoFluxoId: string | null;
}

export interface EtapaLinha {
  id: string;
  chave: string;
  nome: string;
  tipo: string;
  mensagem: string;
  ordem: number;
  proximaEtapaId: string | null;
  proximoFluxoId: string | null;
  config: Record<string, unknown> | null;
  opcoes: OpcaoLinha[];
  conversas: number;
}

export interface Referencia {
  id: string;
  nome: string;
}

interface Contexto {
  fluxoId: string;
  etapas: Referencia[];
  fluxos: Referencia[];
  podeEditar: boolean;
  podeExcluir: boolean;
}

// ---------------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------------

export function EditarFluxo({
  fluxo,
  etapas,
  podeExcluir,
}: {
  fluxo: {
    id: string;
    nome: string;
    descricao: string | null;
    tipo: string;
    status: string;
    etapaInicialId: string | null;
  };
  etapas: Referencia[];
  podeExcluir: boolean;
}) {
  const [estado, salvar] = useActionState<EstadoAcao, FormData>(acaoAtualizarFluxo, {});
  const [estadoExcluir, excluir] = useActionState<EstadoAcao, FormData>(acaoExcluirFluxo, {});

  return (
    <div className="flex flex-col gap-4">
      <form action={salvar} className="flex flex-col gap-4">
        <MensagemAcao estado={estado} />
        <input type="hidden" name="id" value={fluxo.id} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Nome">
            <Entrada name="nome" defaultValue={fluxo.nome} required />
          </Campo>
          <Campo rotulo="Tipo">
            <Selecao name="tipo" defaultValue={fluxo.tipo}>
              {Object.entries(ROTULO_TIPO_FLUXO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Status">
            <Selecao name="status" defaultValue={fluxo.status}>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Etapa inicial" dica="Por onde o fluxo começa">
            <Selecao name="etapaInicialId" defaultValue={fluxo.etapaInicialId ?? ""}>
              <option value="">— Nenhuma —</option>
              {etapas.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Descrição" className="sm:col-span-2 lg:col-span-4">
            <Entrada name="descricao" defaultValue={fluxo.descricao ?? ""} />
          </Campo>
        </div>
        <div>
          <Botao type="submit">Salvar fluxo</Botao>
        </div>
      </form>

      {podeExcluir ? (
        <form action={excluir} className="flex items-center gap-3 border-t border-[var(--color-borda)] pt-3">
          <input type="hidden" name="id" value={fluxo.id} />
          <Botao type="submit" variante="sutil" tamanho="pequeno">
            <Trash2 className="h-3.5 w-3.5" />
            Excluir fluxo
          </Botao>
          <MensagemAcao estado={estadoExcluir} />
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

export function NovaEtapa({ contexto }: { contexto: Contexto }) {
  return (
    <FormularioAcao acao={acaoCriarEtapa} rotuloBotao="Adicionar etapa">
      <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
      <CamposEtapa contexto={contexto} />
    </FormularioAcao>
  );
}

function CamposEtapa({ contexto, etapa }: { contexto: Contexto; etapa?: EtapaLinha }) {
  const config = etapa?.config ?? {};

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {etapa ? null : (
        <Campo rotulo="Chave" dica="Identificador da etapa dentro do fluxo">
          <Entrada name="chave" required pattern="[a-z0-9_]+" placeholder="escolha_plano" />
        </Campo>
      )}
      {etapa ? <input type="hidden" name="chave" value={etapa.chave} /> : null}

      <Campo rotulo="Nome">
        <Entrada name="nome" required defaultValue={etapa?.nome} placeholder="Escolha do plano" />
      </Campo>

      <Campo rotulo="Tipo">
        <Selecao name="tipo" defaultValue={etapa?.tipo ?? "TEXT"}>
          {TIPOS_ETAPA.map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Selecao>
      </Campo>

      <Campo rotulo="Próxima etapa" dica="Para onde ir quando esta terminar">
        <Selecao name="proximaEtapaId" defaultValue={etapa?.proximaEtapaId ?? ""}>
          <option value="">— Nenhuma (encerra) —</option>
          {contexto.etapas
            .filter((item) => item.id !== etapa?.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
        </Selecao>
      </Campo>

      <Campo rotulo="Saltar para outro fluxo" dica="Tem precedência sobre a próxima etapa">
        <Selecao name="proximoFluxoId" defaultValue={etapa?.proximoFluxoId ?? ""}>
          <option value="">— Nenhum —</option>
          {contexto.fluxos
            .filter((item) => item.id !== contexto.fluxoId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
        </Selecao>
      </Campo>

      <Campo rotulo="Título da lista" dica="Só para LIST e escolha de aparelho">
        <Entrada name="titulo" defaultValue={String(config.titulo ?? "")} />
      </Campo>

      <Campo rotulo="Rótulo do botão da lista">
        <Entrada name="rotuloBotao" defaultValue={String(config.rotuloBotao ?? "")} />
      </Campo>

      <Campo rotulo="Variável do INPUT" dica="Onde guardar a resposta aberta">
        <Entrada name="variavel" defaultValue={String(config.variavel ?? "")} />
      </Campo>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="fontePlanos"
          defaultChecked={config.fonte === "planos"}
          className="h-4 w-4"
        />
        Montar as opções com os planos ativos
      </label>

      <Campo rotulo="Mensagem" className="sm:col-span-2 lg:col-span-3">
        <AreaTexto
          name="mensagem"
          rows={3}
          required
          defaultValue={etapa?.mensagem}
          placeholder="Texto enviado ao cliente. Aceita {{customer_name}}, {{plan_name}}…"
        />
      </Campo>
    </div>
  );
}

export function CartaoEtapa({
  etapa,
  contexto,
  posicao,
  inicial,
}: {
  etapa: EtapaLinha;
  contexto: Contexto;
  posicao: number;
  inicial: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [estadoEditar, editar] = useActionState<EstadoAcao, FormData>(acaoAtualizarEtapa, {});
  const [estadoExcluir, excluir] = useActionState<EstadoAcao, FormData>(acaoExcluirEtapa, {});
  const [, mover] = useActionState<EstadoAcao, FormData>(acaoMoverEtapa, {});

  const destino = etapa.proximoFluxoId
    ? contexto.fluxos.find((item) => item.id === etapa.proximoFluxoId)?.nome
    : contexto.etapas.find((item) => item.id === etapa.proximaEtapaId)?.nome;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-borda)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="numerico text-sm text-[var(--color-texto-3)]">{posicao}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{etapa.nome}</span>
              <Badge tom="neutro">{etapa.tipo}</Badge>
              {inicial ? <Badge tom="marca">Etapa inicial</Badge> : null}
              {etapa.conversas > 0 ? (
                <Badge tom="atencao">{etapa.conversas} conversa(s) aqui</Badge>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-[var(--color-texto-3)]">
              {etapa.mensagem}
            </p>
            <p className="mt-1 text-xs text-[var(--color-texto-3)]">
              {destino ? `→ ${destino}` : "→ encerra a conversa"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {contexto.podeEditar ? (
            <>
              <form action={mover}>
                <input type="hidden" name="id" value={etapa.id} />
                <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
                <input type="hidden" name="direcao" value="cima" />
                <Botao variante="sutil" tamanho="icone" type="submit" aria-label="Subir">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Botao>
              </form>
              <form action={mover}>
                <input type="hidden" name="id" value={etapa.id} />
                <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
                <input type="hidden" name="direcao" value="baixo" />
                <Botao variante="sutil" tamanho="icone" type="submit" aria-label="Descer">
                  <ArrowDown className="h-3.5 w-3.5" />
                </Botao>
              </form>
            </>
          ) : null}
          <Botao
            variante="secundario"
            tamanho="pequeno"
            type="button"
            onClick={() => setAberto(!aberto)}
          >
            <ChevronDown className={aberto ? "h-3.5 w-3.5 rotate-180" : "h-3.5 w-3.5"} />
            {aberto ? "Fechar" : "Abrir"}
          </Botao>
        </div>
      </div>

      {aberto ? (
        <div className="flex flex-col gap-4 border-t border-[var(--color-borda)] p-4">
          {contexto.podeEditar ? (
            <form action={editar} className="flex flex-col gap-4">
              <MensagemAcao estado={estadoEditar} />
              <input type="hidden" name="id" value={etapa.id} />
              <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
              <CamposEtapa contexto={contexto} etapa={etapa} />
              <div className="flex gap-2">
                <Botao type="submit" tamanho="pequeno">
                  <Pencil className="h-3.5 w-3.5" />
                  Salvar etapa
                </Botao>
              </div>
            </form>
          ) : null}

          <OpcoesDaEtapa etapa={etapa} contexto={contexto} />

          {contexto.podeExcluir ? (
            <form action={excluir} className="flex items-center gap-3 border-t border-[var(--color-borda)] pt-3">
              <input type="hidden" name="id" value={etapa.id} />
              <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
              <Botao type="submit" variante="sutil" tamanho="pequeno">
                <Trash2 className="h-3.5 w-3.5" />
                Excluir etapa
              </Botao>
              <MensagemAcao estado={estadoExcluir} />
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

function OpcoesDaEtapa({ etapa, contexto }: { etapa: EtapaLinha; contexto: Contexto }) {
  const [estadoNova, criar] = useActionState<EstadoAcao, FormData>(acaoCriarOpcao, {});

  const usaPlanos = etapa.config?.fonte === "planos";
  const usaAparelhos = etapa.tipo === "DEVICE_SELECTION";

  if (usaPlanos || usaAparelhos) {
    return (
      <p className="rounded-lg bg-[var(--color-superficie-3)] px-3 py-2 text-xs text-[var(--color-texto-2)]">
        As opções desta etapa vêm do banco:{" "}
        {usaPlanos ? "os planos ativos" : "os aparelhos ativos"}. Para mudar o que o cliente vê,
        edite o cadastro correspondente.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium">Opções</h4>

      {etapa.opcoes.length === 0 ? (
        <p className="text-xs text-[var(--color-texto-3)]">
          Nenhuma opção. Etapas de menu, botões e lista precisam de pelo menos uma.
        </p>
      ) : (
        etapa.opcoes.map((opcao) => (
          <LinhaOpcao key={opcao.id} opcao={opcao} contexto={contexto} />
        ))
      )}

      {contexto.podeEditar ? (
        <form action={criar} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="etapaId" value={etapa.id} />
          <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
          <Campo rotulo="Rótulo" className="min-w-48 flex-1">
            <Entrada name="rotulo" required placeholder="📺 TV Smart" />
          </Campo>
          <Campo rotulo="Valor" className="w-40">
            <Entrada name="valor" required placeholder="tv_smart" />
          </Campo>
          <Campo rotulo="Vai para" className="w-56">
            <Selecao name="proximaEtapaId" defaultValue="">
              <option value="">— Próxima etapa da etapa —</option>
              {contexto.etapas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Ou salta para o fluxo" className="w-56">
            <Selecao name="proximoFluxoId" defaultValue="">
              <option value="">— Nenhum —</option>
              {contexto.fluxos.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Botao type="submit" tamanho="pequeno">
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Botao>
          <MensagemAcao estado={estadoNova} />
        </form>
      ) : null}
    </div>
  );
}

function LinhaOpcao({ opcao, contexto }: { opcao: OpcaoLinha; contexto: Contexto }) {
  const [editando, setEditando] = useState(false);
  const [estado, salvar] = useActionState<EstadoAcao, FormData>(acaoAtualizarOpcao, {});
  const [estadoExcluir, excluir] = useActionState<EstadoAcao, FormData>(acaoExcluirOpcao, {});

  const destino = opcao.proximoFluxoId
    ? contexto.fluxos.find((item) => item.id === opcao.proximoFluxoId)?.nome
    : contexto.etapas.find((item) => item.id === opcao.proximaEtapaId)?.nome;

  if (!editando) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-borda)] px-3 py-2 text-sm">
        <div>
          <span className={opcao.ativo ? "" : "line-through opacity-60"}>{opcao.rotulo}</span>
          <span className="ml-2 text-xs text-[var(--color-texto-3)]">
            {opcao.valor} {destino ? `→ ${destino}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {contexto.podeEditar ? (
            <Botao
              variante="sutil"
              tamanho="pequeno"
              type="button"
              onClick={() => setEditando(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Botao>
          ) : null}
          {contexto.podeExcluir ? (
            <form action={excluir}>
              <input type="hidden" name="id" value={opcao.id} />
              <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
              <Botao variante="sutil" tamanho="pequeno" type="submit">
                <Trash2 className="h-3.5 w-3.5" />
              </Botao>
            </form>
          ) : null}
          <MensagemAcao estado={estadoExcluir} />
        </div>
      </div>
    );
  }

  return (
    <form action={salvar} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-borda)] p-3">
      <MensagemAcao estado={estado} />
      <input type="hidden" name="id" value={opcao.id} />
      <input type="hidden" name="fluxoId" value={contexto.fluxoId} />
      <Campo rotulo="Rótulo" className="min-w-48 flex-1">
        <Entrada name="rotulo" defaultValue={opcao.rotulo} required />
      </Campo>
      <Campo rotulo="Valor" className="w-40">
        <Entrada name="valor" defaultValue={opcao.valor} required />
      </Campo>
      <Campo rotulo="Vai para" className="w-56">
        <Selecao name="proximaEtapaId" defaultValue={opcao.proximaEtapaId ?? ""}>
          <option value="">— Próxima etapa da etapa —</option>
          {contexto.etapas.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Ou salta para o fluxo" className="w-56">
        <Selecao name="proximoFluxoId" defaultValue={opcao.proximoFluxoId ?? ""}>
          <option value="">— Nenhum —</option>
          {contexto.fluxos.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <label className="flex h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={opcao.ativo} className="h-4 w-4" />
        Ativa
      </label>
      <Botao type="submit" tamanho="pequeno">
        Salvar
      </Botao>
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={() => setEditando(false)}>
        <X className="h-3.5 w-3.5" />
      </Botao>
    </form>
  );
}

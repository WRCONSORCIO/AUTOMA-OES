"use client";

import { useActionState } from "react";
import { Botao, Campo, Entrada, Selecao } from "@/components/ui";
import { MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import {
  acaoSalvarHorarios,
  acaoSalvarPagamento,
  acaoSalvarWhatsApp,
  acaoTestarPagamento,
  acaoTestarWhatsApp,
} from "./acoes";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export interface InstanciaResumo {
  id: string | null;
  nome: string;
  provedor: string;
  apiUrl: string;
  instancia: string | null;
  status: string;
  apiKeyMascarada: string;
  webhookTokenMascarado: string;
  conectadoEm: string | null;
  ultimoErro: string | null;
}

export function FormularioWhatsApp({
  instancia,
  urlWebhook,
  podeEditar,
}: {
  instancia: InstanciaResumo;
  urlWebhook: string;
  podeEditar: boolean;
}) {
  const [estado, salvar] = useActionState<EstadoAcao, FormData>(acaoSalvarWhatsApp, {});
  const [estadoTeste, testar] = useActionState<EstadoAcao, FormData>(acaoTestarWhatsApp, {});

  return (
    <div className="flex flex-col gap-4">
      <form action={salvar} className="flex flex-col gap-4">
        <MensagemAcao estado={estado.erro || estado.sucesso ? estado : estadoTeste} />
        {instancia.id ? <input type="hidden" name="id" value={instancia.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Nome da instância">
            <Entrada name="nome" defaultValue={instancia.nome} required disabled={!podeEditar} />
          </Campo>
          <Campo rotulo="Provedor">
            <Selecao name="provedor" defaultValue={instancia.provedor} disabled={!podeEditar}>
              <option value="EVOLUTION">Evolution API</option>
              <option value="CLOUD_API">WhatsApp Cloud API (oficial)</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Status">
            <Selecao name="status" defaultValue={instancia.status} disabled={!podeEditar}>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </Selecao>
          </Campo>
          <Campo rotulo="URL da API" className="sm:col-span-2">
            <Entrada
              name="apiUrl"
              type="url"
              defaultValue={instancia.apiUrl}
              required
              placeholder="https://evolution.suaempresa.com"
              disabled={!podeEditar}
            />
          </Campo>
          <Campo rotulo="Instância">
            <Entrada
              name="instancia"
              defaultValue={instancia.instancia ?? ""}
              placeholder="minha-instancia"
              disabled={!podeEditar}
            />
          </Campo>
          <Campo rotulo="Chave da API" dica={`Atual: ${instancia.apiKeyMascarada}. Vazio mantém.`}>
            <Entrada name="apiKey" type="password" autoComplete="off" disabled={!podeEditar} />
          </Campo>
          <Campo
            rotulo="Token do webhook"
            dica={`Atual: ${instancia.webhookTokenMascarado}. Vazio mantém.`}
          >
            <Entrada name="webhookToken" type="password" autoComplete="off" disabled={!podeEditar} />
          </Campo>
        </div>

        {podeEditar ? (
          <div className="flex flex-wrap gap-2">
            <Botao type="submit">Salvar WhatsApp</Botao>
            <Botao
              type="submit"
              variante="secundario"
              formAction={testar}
              formNoValidate
              name="id"
              value={instancia.id ?? ""}
            >
              Testar conexão
            </Botao>
          </div>
        ) : null}
      </form>

      <div className="rounded-lg bg-[var(--color-superficie-3)] px-3 py-2 text-xs text-[var(--color-texto-2)]">
        <p className="font-medium">URL para configurar no provedor:</p>
        <code className="break-all">{urlWebhook}</code>
        <p className="mt-1">
          O token acima é exigido no cabeçalho <code>Authorization</code>, <code>apikey</code> ou na
          query <code>?token=</code>. Sem token cadastrado, o endpoint aceita qualquer chamada — o
          que só é aceitável em desenvolvimento.
        </p>
        {instancia.ultimoErro ? (
          <p className="mt-1 text-[var(--color-critico)]">Último erro: {instancia.ultimoErro}</p>
        ) : null}
        {instancia.conectadoEm ? <p className="mt-1">Última conexão: {instancia.conectadoEm}</p> : null}
      </div>
    </div>
  );
}

export function FormularioPagamento({
  configuracao,
  urlWebhook,
  podeEditar,
}: {
  configuracao: {
    provedor: string;
    ambiente: string;
    publishableKey: string | null;
    secretKeyMascarada: string;
    webhookSecretMascarado: string;
    origem: string;
  };
  urlWebhook: string;
  podeEditar: boolean;
}) {
  const [estado, salvar] = useActionState<EstadoAcao, FormData>(acaoSalvarPagamento, {});
  const [estadoTeste, testar] = useActionState<EstadoAcao, void>(
    async () => acaoTestarPagamento(),
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={salvar} className="flex flex-col gap-4">
        <MensagemAcao estado={estado.erro || estado.sucesso ? estado : estadoTeste} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Gateway">
            <Selecao name="provedor" defaultValue={configuracao.provedor} disabled={!podeEditar}>
              <option value="STRIPE">Stripe</option>
              <option value="MANUAL">Nenhum (desativado)</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Ambiente" dica="Test usa chaves sk_test_; Live cobra de verdade">
            <Selecao name="ambiente" defaultValue={configuracao.ambiente} disabled={!podeEditar}>
              <option value="TEST">Test mode</option>
              <option value="LIVE">Live mode</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Publishable key">
            <Entrada
              name="publishableKey"
              defaultValue={configuracao.publishableKey ?? ""}
              placeholder="pk_test_..."
              disabled={!podeEditar}
            />
          </Campo>
          <Campo rotulo="Secret key" dica={`Atual: ${configuracao.secretKeyMascarada}. Vazio mantém.`}>
            <Entrada name="secretKey" type="password" autoComplete="off" disabled={!podeEditar} />
          </Campo>
          <Campo
            rotulo="Webhook secret"
            dica={`Atual: ${configuracao.webhookSecretMascarado}. Vazio mantém.`}
          >
            <Entrada name="webhookSecret" type="password" autoComplete="off" disabled={!podeEditar} />
          </Campo>
        </div>

        {podeEditar ? (
          <div className="flex flex-wrap gap-2">
            <Botao type="submit">Salvar pagamento</Botao>
            <Botao type="button" variante="secundario" onClick={() => testar()}>
              Testar conexão
            </Botao>
          </div>
        ) : null}
      </form>

      <div className="rounded-lg bg-[var(--color-superficie-3)] px-3 py-2 text-xs text-[var(--color-texto-2)]">
        <p className="font-medium">Webhook a cadastrar no gateway:</p>
        <code className="break-all">{urlWebhook}</code>
        <p className="mt-1">
          Eventos necessários: <code>checkout.session.completed</code>,{" "}
          <code>checkout.session.expired</code>, <code>checkout.session.async_payment_succeeded</code>
          , <code>checkout.session.async_payment_failed</code> e <code>charge.refunded</code>.
        </p>
        <p className="mt-1">Configuração em uso: {configuracao.origem}</p>
      </div>
    </div>
  );
}

export function FormularioHorarios({
  horarios,
  podeEditar,
}: {
  horarios: { diaSemana: number; abertura: string; fechamento: string; fechado: boolean }[];
  podeEditar: boolean;
}) {
  const [estado, salvar] = useActionState<EstadoAcao, FormData>(acaoSalvarHorarios, {});

  return (
    <form action={salvar} className="flex flex-col gap-4">
      <MensagemAcao estado={estado} />

      <div className="grid gap-3">
        {DIAS.map((nome, dia) => {
          const atual = horarios.find((item) => item.diaSemana === dia);

          return (
            <div key={dia} className="flex flex-wrap items-end gap-3">
              <span className="w-24 text-sm font-medium">{nome}</span>
              <Campo rotulo="Abre" className="w-32">
                <Entrada
                  type="time"
                  name={`abertura_${dia}`}
                  defaultValue={atual?.abertura ?? "08:00"}
                  disabled={!podeEditar}
                />
              </Campo>
              <Campo rotulo="Fecha" className="w-32">
                <Entrada
                  type="time"
                  name={`fechamento_${dia}`}
                  defaultValue={atual?.fechamento ?? "18:00"}
                  disabled={!podeEditar}
                />
              </Campo>
              <label className="flex h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={`fechado_${dia}`}
                  defaultChecked={atual?.fechado}
                  className="h-4 w-4"
                  disabled={!podeEditar}
                />
                Fechado
              </label>
            </div>
          );
        })}
      </div>

      {podeEditar ? (
        <div>
          <Botao type="submit">Salvar horários</Botao>
        </div>
      ) : null}
    </form>
  );
}

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { formatarDataHora } from "@/lib/format";
import { Aviso, CabecalhoPagina, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { decifrar, mascarar } from "@/server/atendimento/servicos/segredos";
import { lerConfiguracaoPagamento, obterProvedorPagamento } from "@/server/atendimento/pagamentos/fabrica";
import { descreverHorarios } from "@/server/atendimento/dominio/horario";
import {
  FormularioHorarios,
  FormularioPagamento,
  FormularioWhatsApp,
  type InstanciaResumo,
} from "./formularios";

export const metadata: Metadata = { title: "Configurações do atendimento" };

export default async function PaginaConfiguracoes() {
  const sessao = await exigirPermissao("configAtendimento");
  const podeEditar = podeAcessar(sessao.perfil, "configAtendimento", "editar");

  const ambiente = env();
  const base = (ambiente.APP_URL ?? "https://seu-dominio.com").replace(/\/$/, "");

  const [instancia, horarios, configPagamento, provedorPagamento] = await Promise.all([
    prisma.instanciaWhatsApp.findFirst({ orderBy: [{ padrao: "desc" }, { criadoEm: "asc" }] }),
    prisma.horarioAtendimento.findMany({ orderBy: { diaSemana: "asc" } }),
    lerConfiguracaoPagamento(),
    obterProvedorPagamento(),
  ]);

  const resumoInstancia: InstanciaResumo = {
    id: instancia?.id ?? null,
    nome: instancia?.nome ?? "WhatsApp principal",
    provedor: instancia?.provedor ?? "EVOLUTION",
    apiUrl: instancia?.apiUrl ?? ambiente.WHATSAPP_API_URL ?? "",
    instancia: instancia?.instancia ?? ambiente.WHATSAPP_INSTANCE ?? null,
    status: instancia?.status ?? "ATIVO",
    apiKeyMascarada: mascarar(decifrar(instancia?.apiKeyCifrada) ?? ambiente.WHATSAPP_API_KEY),
    webhookTokenMascarado: mascarar(
      decifrar(instancia?.webhookTokenCifrado) ?? ambiente.WHATSAPP_WEBHOOK_TOKEN,
    ),
    conectadoEm: instancia?.conectadoEm ? formatarDataHora(instancia.conectadoEm) : null,
    ultimoErro: instancia?.ultimoErro ?? null,
  };

  const origemPagamento =
    ambiente.PAYMENT_PROVIDER === "SIMULADOR"
      ? "modo simulação (variável de ambiente PAYMENT_PROVIDER=SIMULADOR)"
      : configPagamento?.secretKeyCifrada
        ? "credenciais salvas neste painel"
        : ambiente.STRIPE_SECRET_KEY
          ? "variáveis de ambiente"
          : "nenhuma — o bot não consegue cobrar";

  return (
    <>
      <CabecalhoPagina
        titulo="Configurações do atendimento"
        descricao="Credenciais ficam cifradas no banco e nunca voltam para o navegador: os campos mostram apenas os últimos caracteres."
      />

      {!provedorPagamento.configurado ? (
        <Aviso tom="critico">
          Nenhum gateway de pagamento configurado. O bot percorre o fluxo até a cobrança e então
          transfere o cliente para atendimento humano.
        </Aviso>
      ) : null}

      {provedorPagamento.simulado ? (
        <Aviso tom="atencao">
          Gateway em modo simulação: as cobranças são fictícias e só são confirmadas à mão. Não use
          em produção.
        </Aviso>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent>
          <FormularioWhatsApp
            instancia={resumoInstancia}
            urlWebhook={`${base}/webhooks/whatsapp${instancia ? `?instancia=${instancia.id}` : ""}`}
            podeEditar={podeEditar}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagamentos</CardTitle>
        </CardHeader>
        <CardContent>
          <FormularioPagamento
            configuracao={{
              provedor: configPagamento?.provedor ?? "STRIPE",
              ambiente: configPagamento?.ambiente ?? "TEST",
              publishableKey: configPagamento?.publishableKey ?? ambiente.STRIPE_PUBLISHABLE_KEY ?? null,
              secretKeyMascarada: mascarar(
                decifrar(configPagamento?.secretKeyCifrada) ?? ambiente.STRIPE_SECRET_KEY,
              ),
              webhookSecretMascarado: mascarar(
                decifrar(configPagamento?.webhookSecretCifrado) ?? ambiente.STRIPE_WEBHOOK_SECRET,
              ),
              origem: origemPagamento,
            }}
            urlWebhook={`${base}/webhooks/stripe`}
            podeEditar={podeEditar}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário do atendimento humano</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-texto-2)]">
            O bot funciona 24 horas — pagamento e instruções não dependem de ninguém. O horário vale
            só para o pedido de atendente: fora dele, a conversa fica registrada e o cliente é
            avisado. Hoje: <strong>{descreverHorarios(horarios)}</strong>.
          </p>
          <FormularioHorarios
            horarios={horarios.map((horario) => ({
              diaSemana: horario.diaSemana,
              abertura: horario.abertura,
              fechamento: horario.fechamento,
              fechado: horario.fechado,
            }))}
            podeEditar={podeEditar}
          />
        </CardContent>
      </Card>
    </>
  );
}

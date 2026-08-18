import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import {
  Aviso,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { CartaoEtapa, EditarFluxo, NovaEtapa, type EtapaLinha } from "./formularios";

export const metadata: Metadata = { title: "Fluxo" };

export default async function PaginaFluxo({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPermissao("fluxos");
  const { id } = await params;

  const fluxo = await prisma.fluxo.findUnique({
    where: { id },
    include: {
      etapas: {
        orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
        include: {
          opcoes: { orderBy: { ordem: "asc" } },
          _count: { select: { conversas: true } },
        },
      },
    },
  });

  if (!fluxo) notFound();

  const outrosFluxos = await prisma.fluxo.findMany({
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  const podeEditar = podeAcessar(sessao.perfil, "fluxos", "editar");
  const podeExcluir = podeAcessar(sessao.perfil, "fluxos", "excluir");

  const etapas: EtapaLinha[] = fluxo.etapas.map((etapa) => ({
    id: etapa.id,
    chave: etapa.chave,
    nome: etapa.nome,
    tipo: etapa.tipo,
    mensagem: etapa.mensagem,
    ordem: etapa.ordem,
    proximaEtapaId: etapa.proximaEtapaId,
    proximoFluxoId: etapa.proximoFluxoId,
    config:
      etapa.config && typeof etapa.config === "object" && !Array.isArray(etapa.config)
        ? (etapa.config as Record<string, unknown>)
        : null,
    opcoes: etapa.opcoes.map((opcao) => ({
      id: opcao.id,
      rotulo: opcao.rotulo,
      valor: opcao.valor,
      ativo: opcao.ativo,
      proximaEtapaId: opcao.proximaEtapaId,
      proximoFluxoId: opcao.proximoFluxoId,
    })),
    conversas: etapa._count.conversas,
  }));

  const contexto = {
    fluxoId: fluxo.id,
    etapas: etapas.map((etapa) => ({ id: etapa.id, nome: etapa.nome })),
    fluxos: outrosFluxos,
    podeEditar,
    podeExcluir,
  };

  const semDestino = etapas.filter(
    (etapa) =>
      !etapa.proximaEtapaId &&
      !etapa.proximoFluxoId &&
      etapa.tipo !== "END" &&
      etapa.tipo !== "HUMAN_HANDOFF" &&
      etapa.opcoes.length === 0 &&
      etapa.config?.fonte !== "planos" &&
      etapa.tipo !== "DEVICE_SELECTION",
  );

  return (
    <>
      <CabecalhoPagina
        titulo={fluxo.nome}
        descricao={fluxo.descricao ?? `Fluxo ${fluxo.chave}`}
        acoes={
          <Link
            href="/atendimento/fluxos"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      {!fluxo.etapaInicialId && etapas.length > 0 ? (
        <Aviso tom="critico">
          Este fluxo não tem etapa inicial definida — ele não roda. Escolha a etapa inicial abaixo.
        </Aviso>
      ) : null}

      {semDestino.length > 0 ? (
        <Aviso tom="atencao">
          Etapa sem destino e sem opções: {semDestino.map((etapa) => etapa.nome).join(", ")}. O
          cliente que chegar nela encerra a conversa.
        </Aviso>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Configuração do fluxo</CardTitle>
        </CardHeader>
        <CardContent>
          {podeEditar ? (
            <EditarFluxo
              fluxo={{
                id: fluxo.id,
                nome: fluxo.nome,
                descricao: fluxo.descricao,
                tipo: fluxo.tipo,
                status: fluxo.status,
                etapaInicialId: fluxo.etapaInicialId,
              }}
              etapas={contexto.etapas}
              podeExcluir={podeExcluir}
            />
          ) : (
            <p className="text-sm text-[var(--color-texto-3)]">
              Seu perfil não permite editar fluxos.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Etapas ({etapas.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {etapas.length === 0 ? (
            <p className="text-sm text-[var(--color-texto-3)]">
              Nenhuma etapa. A primeira que você criar vira a etapa inicial.
            </p>
          ) : (
            etapas.map((etapa, indice) => (
              <CartaoEtapa
                key={etapa.id}
                etapa={etapa}
                contexto={contexto}
                posicao={indice + 1}
                inicial={fluxo.etapaInicialId === etapa.id}
              />
            ))
          )}
        </CardContent>
      </Card>

      {podeEditar ? (
        <Card>
          <CardHeader>
            <CardTitle>Nova etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <NovaEtapa contexto={contexto} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

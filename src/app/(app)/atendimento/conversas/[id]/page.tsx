import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { OrigemMensagem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { formatarDataHora, formatarMoeda } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { ROTULO_STATUS_PAGAMENTO } from "@/server/atendimento/servicos/pedidos";
import { EstadoConversa } from "../estado";
import { AcoesConversa, ResponderCliente } from "./formularios";

export const metadata: Metadata = { title: "Conversa" };

const ROTULO_ORIGEM: Record<OrigemMensagem, string> = {
  CLIENTE: "👤 Cliente",
  BOT: "🤖 Bot",
  ATENDENTE: "👨‍💻 Atendente",
  SISTEMA: "⚙️ Sistema",
};

export default async function PaginaConversa({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPermissao("conversas");
  const { id } = await params;

  const conversa = await prisma.conversa.findUnique({
    where: { id },
    include: {
      cliente: true,
      atendente: { select: { nome: true } },
      fluxo: { select: { nome: true } },
      etapa: { select: { nome: true, tipo: true } },
      mensagens: { orderBy: { criadoEm: "asc" }, include: { usuario: { select: { nome: true } } } },
      pedidos: { include: { plano: { select: { nome: true } } }, orderBy: { criadoEm: "desc" } },
    },
  });

  if (!conversa) notFound();

  const podeEditar = podeAcessar(sessao.perfil, "conversas", "editar");
  const contexto = conversa.contexto as Record<string, unknown> | null;

  return (
    <>
      <CabecalhoPagina
        titulo={conversa.cliente.nome ?? conversa.cliente.telefoneExibicao}
        descricao={`${conversa.cliente.telefoneExibicao} · iniciada em ${formatarDataHora(conversa.iniciadaEm)}`}
        acoes={
          <Link
            href="/atendimento/conversas"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
              <EstadoConversa status={conversa.status} />
            </CardHeader>
            <CardContent className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
              {conversa.mensagens.length === 0 ? (
                <p className="text-sm text-[var(--color-texto-3)]">Nenhuma mensagem ainda.</p>
              ) : (
                conversa.mensagens.map((mensagem) => (
                  <div
                    key={mensagem.id}
                    className={cn(
                      "max-w-[85%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap",
                      mensagem.origem === "CLIENTE"
                        ? "self-start border-[var(--color-borda)] bg-[var(--color-superficie-3)]"
                        : "self-end border-[var(--color-marca)] bg-[var(--color-marca-suave)]",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-texto-3)]">
                      <span>{ROTULO_ORIGEM[mensagem.origem]}</span>
                      {mensagem.usuario ? <span>· {mensagem.usuario.nome}</span> : null}
                      <span>· {formatarDataHora(mensagem.criadoEm)}</span>
                      {mensagem.erro ? <span className="text-[var(--color-critico)]">· falhou</span> : null}
                    </div>
                    {mensagem.conteudo}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Responder</CardTitle>
              <AcoesConversa id={conversa.id} status={conversa.status} podeEditar={podeEditar} />
            </CardHeader>
            <CardContent>
              {podeEditar ? (
                <ResponderCliente id={conversa.id} status={conversa.status} />
              ) : (
                <p className="text-sm text-[var(--color-texto-3)]">
                  Seu perfil não permite responder conversas.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Onde o cliente está</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Linha rotulo="Fluxo" valor={conversa.fluxo?.nome ?? "—"} />
              <Linha rotulo="Etapa" valor={conversa.etapa?.nome ?? "—"} />
              <Linha rotulo="Tipo da etapa" valor={conversa.etapa?.tipo ?? "—"} />
              <Linha rotulo="Atendente" valor={conversa.atendente?.nome ?? "—"} />
              <Linha rotulo="Última mensagem" valor={formatarDataHora(conversa.ultimaMensagemEm)} />
              {conversa.encerradaEm ? (
                <Linha rotulo="Encerrada em" valor={formatarDataHora(conversa.encerradaEm)} />
              ) : null}
            </CardContent>
          </Card>

          {contexto && Object.keys(contexto).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Respostas guardadas</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {Object.entries(contexto).map(([chave, valor]) => (
                  <Linha key={chave} rotulo={chave} valor={String(valor)} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Pedidos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {conversa.pedidos.length === 0 ? (
                <p className="text-[var(--color-texto-3)]">Nenhum pedido nesta conversa.</p>
              ) : (
                conversa.pedidos.map((pedido) => (
                  <Link
                    key={pedido.id}
                    href={`/atendimento/pedidos/${pedido.id}`}
                    className="rounded-lg border border-[var(--color-borda)] px-3 py-2 hover:bg-[var(--color-superficie-3)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">#{pedido.numero}</span>
                      <Badge tom={pedido.status === "PAID" ? "bom" : "neutro"}>
                        {ROTULO_STATUS_PAGAMENTO[pedido.status]}
                      </Badge>
                    </div>
                    <div className="text-xs text-[var(--color-texto-3)]">
                      {pedido.plano.nome} · {formatarMoeda(Number(pedido.valor))}
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--color-texto-3)]">{rotulo}</span>
      <span className="text-right font-medium">{valor}</span>
    </div>
  );
}

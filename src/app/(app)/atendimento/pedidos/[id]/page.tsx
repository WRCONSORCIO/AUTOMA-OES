import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { formatarDataHora, formatarMoeda } from "@/lib/format";
import {
  Badge,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { obterProvedorPagamento } from "@/server/atendimento/pagamentos/fabrica";
import { ROTULO_STATUS_PAGAMENTO } from "@/server/atendimento/servicos/pedidos";
import { TOM_STATUS } from "../estado";
import { AcoesPedido } from "./formularios";

export const metadata: Metadata = { title: "Pedido" };

export default async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPermissao("pedidos");
  const { id } = await params;

  const pedido = await prisma.pedido.findUnique({
    where: { id },
    include: {
      cliente: true,
      plano: true,
      conversa: { select: { id: true, status: true } },
      pagamentos: { orderBy: { criadoEm: "desc" } },
      historico: { orderBy: { criadoEm: "asc" }, include: { usuario: { select: { nome: true } } } },
    },
  });

  if (!pedido) notFound();

  const provedor = await obterProvedorPagamento();
  const podeEditar = podeAcessar(sessao.perfil, "pedidos", "editar");

  return (
    <>
      <CabecalhoPagina
        titulo={`Pedido #${pedido.numero}`}
        descricao={`${pedido.plano.nome} · ${formatarMoeda(Number(pedido.valor))}`}
        acoes={
          <Link
            href="/atendimento/pedidos"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Dados</CardTitle>
            <Badge tom={TOM_STATUS[pedido.status]}>{ROTULO_STATUS_PAGAMENTO[pedido.status]}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Linha rotulo="Cliente" valor={pedido.cliente.nome ?? "Sem nome"} />
            <Linha rotulo="Telefone" valor={pedido.cliente.telefoneExibicao} />
            <Linha rotulo="Plano" valor={`${pedido.plano.nome} (${pedido.plano.duracaoDias} dias)`} />
            <Linha rotulo="Valor" valor={formatarMoeda(Number(pedido.valor))} />
            <Linha rotulo="Tipo" valor={pedido.tipo === "RENOVACAO" ? "Renovação" : "Nova contratação"} />
            <Linha rotulo="Gateway" valor={pedido.provedorPagamento} />
            <Linha rotulo="Criado" valor={formatarDataHora(pedido.criadoEm)} />
            <Linha rotulo="Pago" valor={pedido.pagoEm ? formatarDataHora(pedido.pagoEm) : "—"} />
            <Linha rotulo="Expira" valor={pedido.expiraEm ? formatarDataHora(pedido.expiraEm) : "—"} />
            {pedido.conversa ? (
              <div className="pt-2">
                <Link
                  href={`/atendimento/conversas/${pedido.conversa.id}`}
                  className="text-sm text-[var(--color-marca-forte)] hover:underline"
                >
                  Abrir a conversa deste pedido →
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ações</CardTitle>
          </CardHeader>
          <CardContent>
            {podeEditar ? (
              <AcoesPedido
                id={pedido.id}
                status={pedido.status}
                modoSimulado={Boolean(provedor.simulado)}
              />
            ) : (
              <p className="text-sm text-[var(--color-texto-3)]">
                Seu perfil não permite alterar pedidos.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cobranças no gateway</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {pedido.pagamentos.length === 0 ? (
              <p className="text-[var(--color-texto-3)]">Nenhuma cobrança gerada.</p>
            ) : (
              pedido.pagamentos.map((pagamento) => (
                <div
                  key={pagamento.id}
                  className="rounded-lg border border-[var(--color-borda)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="numerico text-xs">{pagamento.externoId}</span>
                    <Badge tom={TOM_STATUS[pagamento.status]}>
                      {ROTULO_STATUS_PAGAMENTO[pagamento.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-texto-3)]">
                    {pagamento.provedor} · {formatarDataHora(pagamento.criadoEm)}
                  </div>
                  {pagamento.link ? (
                    <a
                      href={pagamento.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-xs text-[var(--color-marca-forte)] hover:underline"
                    >
                      {pagamento.link}
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {pedido.historico.length === 0 ? (
              <p className="text-[var(--color-texto-3)]">Sem movimentações.</p>
            ) : (
              pedido.historico.map((linha) => (
                <div key={linha.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div>{linha.descricao}</div>
                    {linha.usuario ? (
                      <div className="text-xs text-[var(--color-texto-3)]">
                        por {linha.usuario.nome}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--color-texto-3)]">
                    {formatarDataHora(linha.criadoEm)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
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

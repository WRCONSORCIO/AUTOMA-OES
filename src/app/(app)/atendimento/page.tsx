import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, MessagesSquare, ShoppingCart, UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { CabecalhoPagina, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { intervaloDoPeriodo, type ChavePeriodo } from "./periodo";
import { FiltroPeriodo } from "./filtro-periodo";

export const metadata: Metadata = { title: "Atendimento" };

export default async function PaginaAtendimento({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPermissao("atendimento");

  const parametros = await searchParams;
  const periodo = (Array.isArray(parametros.periodo) ? parametros.periodo[0] : parametros.periodo) as
    | ChavePeriodo
    | undefined;
  const intervalo = intervaloDoPeriodo(periodo, parametros);

  const janela = { gte: intervalo.inicio, lte: intervalo.fim };

  const [
    clientesNovos,
    clientesAtivos,
    conversasAbertas,
    conversasHumanas,
    pedidosPeriodo,
    pagamentosPendentes,
    pagamentosAprovados,
    faturamento,
  ] = await Promise.all([
    prisma.clienteAtendimento.count({ where: { criadoEm: janela } }),
    prisma.clienteAtendimento.count({ where: { status: "ATIVO" } }),
    prisma.conversa.count({ where: { status: { in: ["BOT", "WAITING_PAYMENT"] } } }),
    prisma.conversa.count({ where: { status: "HUMAN" } }),
    prisma.pedido.count({ where: { criadoEm: janela } }),
    prisma.pedido.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.pedido.count({ where: { status: "PAID", pagoEm: janela } }),
    prisma.pedido.aggregate({
      where: { status: "PAID", pagoEm: janela },
      _sum: { valor: true },
    }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Atendimento"
        descricao="Visão geral do bot de WhatsApp: quem chegou, quem está conversando e o que foi pago no período."
        acoes={<FiltroPeriodo base="/atendimento" intervalo={intervalo} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Clientes novos"
          valor={formatarNumero(clientesNovos)}
          detalhe={`${formatarNumero(clientesAtivos)} clientes ativos no total`}
          icone={<UserRound className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Conversas abertas"
          valor={formatarNumero(conversasAbertas)}
          detalhe="Em atendimento pelo bot"
          icone={<MessagesSquare className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Atendimento humano"
          valor={formatarNumero(conversasHumanas)}
          tom={conversasHumanas > 0 ? "atencao" : "neutro"}
          detalhe="Conversas aguardando atendente"
          icone={<MessagesSquare className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Pedidos no período"
          valor={formatarNumero(pedidosPeriodo)}
          detalhe={`${formatarNumero(pagamentosPendentes)} aguardando pagamento`}
          icone={<ShoppingCart className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Pagamentos aprovados"
          valor={formatarNumero(pagamentosAprovados)}
          tom="bom"
          detalhe="Confirmados pelo gateway"
          icone={<CircleDollarSign className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Faturamento do período"
          valor={formatarMoeda(Number(faturamento._sum.valor ?? 0))}
          tom="bom"
          detalhe="Soma dos pedidos pagos"
          icone={<CircleDollarSign className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Por onde começar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Atalho href="/atendimento/planos" titulo="Planos" texto="Cadastre nome, duração e preço do que o bot vende." />
          <Atalho href="/atendimento/aparelhos" titulo="Aparelhos" texto="A lista oferecida depois do pagamento confirmado." />
          <Atalho href="/atendimento/fluxos" titulo="Fluxos" texto="As etapas da conversa, sem tocar em código." />
          <Atalho href="/atendimento/mensagens" titulo="Mensagens" texto="Os textos enviados em cada momento." />
          <Atalho href="/atendimento/configuracoes" titulo="Configurações" texto="WhatsApp, gateway de pagamento e horário." />
          <Atalho href="/atendimento/conversas" titulo="Conversas" texto="Inbox: acompanhar, assumir e devolver ao bot." />
        </CardContent>
      </Card>
    </>
  );
}

function Atalho({ href, titulo, texto }: { href: string; titulo: string; texto: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--color-borda)] px-4 py-3 transition-colors hover:bg-[var(--color-superficie-3)]"
    >
      <span className="font-medium">{titulo}</span>
      <p className="text-xs text-[var(--color-texto-3)]">{texto}</p>
    </Link>
  );
}

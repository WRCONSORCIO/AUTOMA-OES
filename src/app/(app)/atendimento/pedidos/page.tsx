import type { Metadata } from "next";
import Link from "next/link";
import type { StatusPagamento } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { formatarDataHora, formatarMoeda, formatarNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Cabecalho,
  CabecalhoPagina,
  Card,
  CardContent,
  Tabela,
  TabelaVazia,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { ROTULO_STATUS_PAGAMENTO } from "@/server/atendimento/servicos/pedidos";
import { intervaloDoPeriodo, type ChavePeriodo } from "../periodo";
import { TOM_STATUS } from "./estado";
import { FiltroPeriodo } from "../filtro-periodo";

export const metadata: Metadata = { title: "Pedidos" };

const STATUS: { chave: string; rotulo: string; valores?: StatusPagamento[] }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "pendentes", rotulo: "Aguardando", valores: ["PENDING", "PROCESSING"] },
  { chave: "pagos", rotulo: "Pagos", valores: ["PAID"] },
  { chave: "problemas", rotulo: "Falha / expirado", valores: ["FAILED", "EXPIRED", "CANCELLED"] },
  { chave: "estornados", rotulo: "Estornados", valores: ["REFUNDED"] },
];

export default async function PaginaPedidos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPermissao("pedidos");

  const parametros = await searchParams;
  const periodo = (Array.isArray(parametros.periodo) ? parametros.periodo[0] : parametros.periodo) as
    | ChavePeriodo
    | undefined;
  const intervalo = intervaloDoPeriodo(periodo ?? "30dias", parametros);

  const filtroBruto = Array.isArray(parametros.status) ? parametros.status[0] : parametros.status;
  const filtro = STATUS.find((item) => item.chave === filtroBruto) ?? STATUS[0]!;

  const janela = { gte: intervalo.inicio, lte: intervalo.fim };

  const [pedidos, pagos, aguardando] = await Promise.all([
    prisma.pedido.findMany({
      where: {
        criadoEm: janela,
        status: filtro.valores ? { in: filtro.valores } : undefined,
      },
      include: {
        cliente: { select: { nome: true, telefoneExibicao: true } },
        plano: { select: { nome: true } },
      },
      orderBy: { criadoEm: "desc" },
      take: 200,
    }),
    prisma.pedido.aggregate({
      where: { status: "PAID", pagoEm: janela },
      _sum: { valor: true },
      _count: true,
    }),
    prisma.pedido.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Pedidos"
        descricao="Cada cobrança gerada pelo bot. O status vem do gateway — nada aqui muda para pago por mensagem do cliente."
        acoes={<FiltroPeriodo base="/atendimento/pedidos" intervalo={intervalo} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador rotulo="Pedidos no período" valor={formatarNumero(pedidos.length)} />
        <Indicador
          rotulo="Pagos no período"
          valor={formatarMoeda(Number(pagos._sum.valor ?? 0))}
          detalhe={`${formatarNumero(pagos._count)} pagamentos confirmados`}
          tom="bom"
        />
        <Indicador
          rotulo="Aguardando pagamento"
          valor={formatarNumero(aguardando)}
          tom={aguardando > 0 ? "atencao" : "neutro"}
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-borda)] p-1">
        {STATUS.map((item) => (
          <Link
            key={item.chave}
            href={`/atendimento/pedidos?status=${item.chave}&periodo=${intervalo.chave}&de=${intervalo.de}&ate=${intervalo.ate}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              filtro.chave === item.chave
                ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
            )}
          >
            {item.rotulo}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Pedido</Th>
                <Th>Cliente</Th>
                <Th>Plano</Th>
                <Th className="text-right">Valor</Th>
                <Th>Status</Th>
                <Th>Criado</Th>
                <Th>Pago</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {pedidos.length === 0 ? (
                <TabelaVazia colunas={7} mensagem="Nenhum pedido no período." />
              ) : (
                pedidos.map((pedido) => (
                  <Tr key={pedido.id}>
                    <Td className="font-medium">
                      <Link href={`/atendimento/pedidos/${pedido.id}`} className="hover:underline">
                        #{pedido.numero}
                      </Link>
                    </Td>
                    <Td>
                      {pedido.cliente.nome ?? "Sem nome"}
                      <div className="text-xs text-[var(--color-texto-3)]">
                        {pedido.cliente.telefoneExibicao}
                      </div>
                    </Td>
                    <Td>{pedido.plano.nome}</Td>
                    <Td className="numerico text-right">{formatarMoeda(Number(pedido.valor))}</Td>
                    <Td>
                      <Badge tom={TOM_STATUS[pedido.status]}>
                        {ROTULO_STATUS_PAGAMENTO[pedido.status]}
                      </Badge>
                    </Td>
                    <Td className="text-sm text-[var(--color-texto-3)]">
                      {formatarDataHora(pedido.criadoEm)}
                    </Td>
                    <Td className="text-sm text-[var(--color-texto-3)]">
                      {pedido.pagoEm ? formatarDataHora(pedido.pagoEm) : "—"}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

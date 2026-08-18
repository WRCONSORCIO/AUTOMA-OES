import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { formatarDataHora, formatarMoeda } from "@/lib/format";
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

export const metadata: Metadata = { title: "Clientes" };

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPermissao("clientesBot");

  const parametros = await searchParams;
  const busca = (Array.isArray(parametros.q) ? parametros.q[0] : parametros.q)?.trim();

  const clientes = await prisma.clienteAtendimento.findMany({
    where: busca
      ? {
          OR: [
            { nome: { contains: busca, mode: "insensitive" } },
            { telefone: { contains: busca.replace(/\D+/g, "") || busca } },
          ],
        }
      : undefined,
    include: {
      _count: { select: { conversas: true, pedidos: true } },
      pedidos: { where: { status: "PAID" }, select: { valor: true } },
    },
    orderBy: [{ ultimaInteracaoEm: "desc" }, { criadoEm: "desc" }],
    take: 200,
  });

  return (
    <>
      <CabecalhoPagina
        titulo="Clientes"
        descricao="Cadastro automático a partir do WhatsApp. Um número é um cliente: o telefone normalizado é a identidade, então o mesmo contato nunca vira dois cadastros."
      />

      <form action="/atendimento/clientes" className="flex items-end gap-2">
        <input
          name="q"
          defaultValue={busca}
          placeholder="Nome ou telefone"
          className="h-10 w-64 rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-2)] px-3 text-sm"
        />
        <button
          type="submit"
          className="h-10 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
        >
          Buscar
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Cliente</Th>
                <Th>Telefone</Th>
                <Th className="text-right">Conversas</Th>
                <Th className="text-right">Pedidos</Th>
                <Th className="text-right">Total pago</Th>
                <Th>Última interação</Th>
                <Th>Status</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {clientes.length === 0 ? (
                <TabelaVazia colunas={7} mensagem="Nenhum cliente ainda." />
              ) : (
                clientes.map((cliente) => {
                  const total = cliente.pedidos.reduce(
                    (soma, pedido) => soma + Number(pedido.valor),
                    0,
                  );

                  return (
                    <Tr key={cliente.id}>
                      <Td className="font-medium">
                        <Link
                          href={`/atendimento/conversas?q=${encodeURIComponent(cliente.telefone)}`}
                          className="hover:underline"
                        >
                          {cliente.nome ?? "Sem nome"}
                        </Link>
                      </Td>
                      <Td className="numerico">{cliente.telefoneExibicao}</Td>
                      <Td className="numerico text-right">{cliente._count.conversas}</Td>
                      <Td className="numerico text-right">{cliente._count.pedidos}</Td>
                      <Td className="numerico text-right">{formatarMoeda(total)}</Td>
                      <Td className="text-sm text-[var(--color-texto-3)]">
                        {cliente.ultimaInteracaoEm ? formatarDataHora(cliente.ultimaInteracaoEm) : "—"}
                      </Td>
                      <Td>
                        <Badge tom={cliente.status === "ATIVO" ? "bom" : "neutro"}>
                          {cliente.status === "ATIVO" ? "Ativo" : "Inativo"}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

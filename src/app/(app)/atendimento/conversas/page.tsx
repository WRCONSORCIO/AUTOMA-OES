import type { Metadata } from "next";
import Link from "next/link";
import type { StatusConversa } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { formatarDataHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
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
import { EstadoConversa, ROTULO_CONVERSA } from "./estado";

export const metadata: Metadata = { title: "Conversas" };

const FILTROS: { chave: string; rotulo: string; status?: StatusConversa[] }[] = [
  { chave: "abertas", rotulo: "Abertas", status: ["BOT", "WAITING_PAYMENT", "HUMAN"] },
  { chave: "humanas", rotulo: "Atendimento humano", status: ["HUMAN"] },
  { chave: "pagamento", rotulo: "Aguardando pagamento", status: ["WAITING_PAYMENT"] },
  { chave: "encerradas", rotulo: "Encerradas", status: ["CLOSED"] },
  { chave: "todas", rotulo: "Todas" },
];

export default async function PaginaConversas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPermissao("conversas");

  const parametros = await searchParams;
  const bruto = Array.isArray(parametros.filtro) ? parametros.filtro[0] : parametros.filtro;
  const filtro = FILTROS.find((item) => item.chave === bruto) ?? FILTROS[0]!;
  const busca = (Array.isArray(parametros.q) ? parametros.q[0] : parametros.q)?.trim();

  const conversas = await prisma.conversa.findMany({
    where: {
      status: filtro.status ? { in: filtro.status } : undefined,
      cliente: busca
        ? {
            OR: [
              { nome: { contains: busca, mode: "insensitive" } },
              { telefone: { contains: busca.replace(/\D+/g, "") || busca } },
            ],
          }
        : undefined,
    },
    include: {
      cliente: true,
      atendente: { select: { nome: true } },
      etapa: { select: { nome: true } },
      mensagens: { orderBy: { criadoEm: "desc" }, take: 1 },
    },
    orderBy: { ultimaMensagemEm: "desc" },
    take: 100,
  });

  return (
    <>
      <CabecalhoPagina
        titulo="Conversas"
        descricao="Tudo o que passou pelo WhatsApp. Conversa em atendimento humano aparece em vermelho — enquanto estiver assim, o bot não responde nada."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-borda)] p-1">
          {FILTROS.map((item) => (
            <Link
              key={item.chave}
              href={`/atendimento/conversas?filtro=${item.chave}`}
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

        <form action="/atendimento/conversas" className="flex items-end gap-2">
          <input type="hidden" name="filtro" value={filtro.chave} />
          <input
            name="q"
            defaultValue={busca}
            placeholder="Nome ou telefone"
            className="h-10 w-56 rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-2)] px-3 text-sm"
          />
          <button
            type="submit"
            className="h-10 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
          >
            Buscar
          </button>
        </form>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Cliente</Th>
                <Th>Última mensagem</Th>
                <Th>Etapa</Th>
                <Th>Status</Th>
                <Th>Atendente</Th>
                <Th>Atualizada</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {conversas.length === 0 ? (
                <TabelaVazia colunas={6} mensagem="Nenhuma conversa neste filtro." />
              ) : (
                conversas.map((conversa) => (
                  <Tr key={conversa.id}>
                    <Td>
                      <Link
                        href={`/atendimento/conversas/${conversa.id}`}
                        className="font-medium hover:underline"
                      >
                        {conversa.cliente.nome ?? "Sem nome"}
                      </Link>
                      <div className="text-xs text-[var(--color-texto-3)]">
                        {conversa.cliente.telefoneExibicao}
                      </div>
                    </Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-2 text-sm text-[var(--color-texto-2)]">
                        {conversa.mensagens[0]?.conteudo ?? "—"}
                      </span>
                    </Td>
                    <Td className="text-sm text-[var(--color-texto-2)]">
                      {conversa.etapa?.nome ?? "—"}
                    </Td>
                    <Td>
                      <EstadoConversa status={conversa.status} />
                    </Td>
                    <Td className="text-sm">{conversa.atendente?.nome ?? "—"}</Td>
                    <Td className="text-sm text-[var(--color-texto-3)]">
                      {formatarDataHora(conversa.ultimaMensagemEm)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--color-texto-3)]">
        Estados possíveis: {Object.values(ROTULO_CONVERSA).join(" · ")}
      </p>
    </>
  );
}

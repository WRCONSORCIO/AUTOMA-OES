import type { Metadata } from "next";
import Link from "next/link";
import type { TipoLogAtendimento } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { formatarDataHora } from "@/lib/format";
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
import { intervaloDoPeriodo, type ChavePeriodo } from "../periodo";
import { FiltroPeriodo } from "../filtro-periodo";

export const metadata: Metadata = { title: "Logs do atendimento" };

const TIPOS: TipoLogAtendimento[] = [
  "MENSAGEM_RECEBIDA",
  "MENSAGEM_ENVIADA",
  "MUDANCA_ETAPA",
  "PEDIDO_CRIADO",
  "PAGAMENTO",
  "WEBHOOK",
  "TRANSFERENCIA_HUMANA",
  "RETORNO_AO_BOT",
  "ERRO",
];

export default async function PaginaLogs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPermissao("logsAtendimento");

  const parametros = await searchParams;
  const periodo = (Array.isArray(parametros.periodo) ? parametros.periodo[0] : parametros.periodo) as
    | ChavePeriodo
    | undefined;
  const intervalo = intervaloDoPeriodo(periodo ?? "7dias", parametros);

  const tipoBruto = Array.isArray(parametros.tipo) ? parametros.tipo[0] : parametros.tipo;
  const tipo = TIPOS.includes(tipoBruto as TipoLogAtendimento)
    ? (tipoBruto as TipoLogAtendimento)
    : undefined;

  const logs = await prisma.logAtendimento.findMany({
    where: { criadoEm: { gte: intervalo.inicio, lte: intervalo.fim }, tipo },
    include: { cliente: { select: { telefoneExibicao: true, nome: true } } },
    orderBy: { criadoEm: "desc" },
    take: 300,
  });

  const base = `/atendimento/logs?periodo=${intervalo.chave}&de=${intervalo.de}&ate=${intervalo.ate}`;

  return (
    <>
      <CabecalhoPagina
        titulo="Logs do atendimento"
        descricao="O que aconteceu com as conversas: mensagens, mudanças de etapa, pedidos, pagamentos, webhooks e erros. Credenciais e tokens nunca são registrados."
        acoes={<FiltroPeriodo base="/atendimento/logs" intervalo={intervalo} />}
      />

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-borda)] p-1">
        <Link
          href={base}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            !tipo
              ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
              : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
          )}
        >
          Todos
        </Link>
        {TIPOS.map((item) => (
          <Link
            key={item}
            href={`${base}&tipo=${item}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              tipo === item
                ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
            )}
          >
            {item.replaceAll("_", " ").toLowerCase()}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Quando</Th>
                <Th>Tipo</Th>
                <Th>Descrição</Th>
                <Th>Cliente</Th>
                <Th>Conversa</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {logs.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhum registro no período." />
              ) : (
                logs.map((log) => (
                  <Tr key={log.id}>
                    <Td className="whitespace-nowrap text-sm text-[var(--color-texto-3)]">
                      {formatarDataHora(log.criadoEm)}
                    </Td>
                    <Td>
                      <Badge tom={log.tipo === "ERRO" ? "critico" : "neutro"}>
                        {log.tipo.replaceAll("_", " ").toLowerCase()}
                      </Badge>
                    </Td>
                    <Td className="text-sm">{log.descricao}</Td>
                    <Td className="text-sm text-[var(--color-texto-2)]">
                      {log.cliente?.nome ?? log.cliente?.telefoneExibicao ?? "—"}
                    </Td>
                    <Td>
                      {log.conversaId ? (
                        <Link
                          href={`/atendimento/conversas/${log.conversaId}`}
                          className="text-sm text-[var(--color-marca-forte)] hover:underline"
                        >
                          abrir
                        </Link>
                      ) : (
                        "—"
                      )}
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

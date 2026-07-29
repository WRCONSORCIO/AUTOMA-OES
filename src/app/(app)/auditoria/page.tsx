import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { formatarDataHora } from "@/lib/format";
import { inteiro, texto, type ParametrosBusca } from "@/lib/filtros";
import { parseDataBr } from "@/lib/normalize";
import {
  Badge,
  Cabecalho,
  CabecalhoPagina,
  Campo,
  Card,
  CardContent,
  Entrada,
  Selecao,
  Tabela,
  TabelaVazia,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Paginacao } from "@/components/paginacao";

export const metadata: Metadata = { title: "Auditoria" };

const POR_PAGINA = 50;

const ACOES = [
  "LOGIN",
  "LOGOUT",
  "LOGIN_FALHA",
  "CRIACAO",
  "ATUALIZACAO",
  "INATIVACAO",
  "REATIVACAO",
  "IMPORTACAO",
  "MUDANCA_CATEGORIA",
  "TRANSFERENCIA_VENDEDOR",
  "MUDANCA_EQUIPE",
  "MUDANCA_GERENCIA",
  "MUDANCA_PERCENTUAL",
  "RECUPERACAO",
  "ESTORNO",
  "BACKUP",
  "RECALCULO_COMISSAO",
] as const;

function tomDaAcao(acao: string): "neutro" | "bom" | "atencao" | "critico" | "marca" {
  if (acao === "LOGIN_FALHA") return "critico";
  if (acao.startsWith("MUDANCA") || acao === "TRANSFERENCIA_VENDEDOR") return "atencao";
  if (acao === "IMPORTACAO" || acao === "BACKUP") return "marca";
  if (acao === "CRIACAO") return "bom";
  return "neutro";
}

export default async function PaginaAuditoria({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  await exigirPermissao("auditoria");

  const brutos = await searchParams;
  const pagina = inteiro(brutos, "pagina", 1);
  const acao = texto(brutos, "acao");
  const entidade = texto(brutos, "entidade");
  const busca = texto(brutos, "q");
  const de = parseDataBr(texto(brutos, "de") ?? "");
  const ate = parseDataBr(texto(brutos, "ate") ?? "");

  const fimDoDia = ate ? new Date(ate.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;

  const where: Prisma.AuditLogWhereInput = {
    ...(acao ? { acao: acao as (typeof ACOES)[number] } : {}),
    ...(entidade ? { entidade } : {}),
    ...(de || fimDoDia
      ? { criadoEm: { ...(de ? { gte: de } : {}), ...(fimDoDia ? { lte: fimDoDia } : {}) } }
      : {}),
    ...(busca
      ? {
          OR: [
            { descricao: { contains: busca, mode: "insensitive" } },
            { usuarioNome: { contains: busca, mode: "insensitive" } },
            { entidadeId: { contains: busca } },
          ],
        }
      : {}),
  };

  const [registros, total, entidades] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["entidade"], orderBy: { entidade: "asc" } }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Registro imutável de todas as alterações do sistema: quem fez, quando, o que mudou e a partir de qual endereço."
      />

      <form
        action="/auditoria"
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
      >
        <Campo rotulo="De" className="w-[9.5rem]">
          <Entrada type="date" name="de" defaultValue={texto(brutos, "de") ?? ""} />
        </Campo>
        <Campo rotulo="Até" className="w-[9.5rem]">
          <Entrada type="date" name="ate" defaultValue={texto(brutos, "ate") ?? ""} />
        </Campo>
        <Campo rotulo="Ação" className="w-56">
          <Selecao name="acao" defaultValue={acao ?? ""}>
            <option value="">Todas</option>
            {ACOES.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Entidade" className="w-48">
          <Selecao name="entidade" defaultValue={entidade ?? ""}>
            <option value="">Todas</option>
            {entidades.map((item) => (
              <option key={item.entidade} value={item.entidade}>
                {item.entidade}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Busca" className="min-w-52 flex-1">
          <Entrada name="q" defaultValue={busca ?? ""} placeholder="Descrição ou usuário" />
        </Campo>
        <button
          type="submit"
          className="h-10 rounded-lg bg-[var(--color-marca)] px-4 text-sm font-medium text-white hover:bg-[var(--color-marca-forte)] dark:text-[#0b0b0b]"
        >
          Filtrar
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Data e hora</Th>
                <Th>Usuário</Th>
                <Th>Ação</Th>
                <Th>Entidade</Th>
                <Th>Descrição</Th>
                <Th>Alterações</Th>
                <Th>Origem</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {registros.length === 0 ? (
                <TabelaVazia colunas={7} mensagem="Nenhum registro de auditoria encontrado." />
              ) : (
                registros.map((registro) => (
                  <Tr key={registro.id}>
                    <Td className="whitespace-nowrap">{formatarDataHora(registro.criadoEm)}</Td>
                    <Td>{registro.usuarioNome ?? "Sistema"}</Td>
                    <Td>
                      <Badge tom={tomDaAcao(registro.acao)}>
                        {registro.acao.replaceAll("_", " ")}
                      </Badge>
                    </Td>
                    <Td>{registro.entidade}</Td>
                    <Td className="max-w-96">{registro.descricao}</Td>
                    <Td>
                      {registro.dadosAntes || registro.dadosDepois ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-[var(--color-marca-forte)]">
                            Ver diff
                          </summary>
                          <pre className="mt-2 max-w-md overflow-x-auto rounded-md bg-[var(--color-superficie-3)] p-2 text-xs">
{JSON.stringify({ antes: registro.dadosAntes, depois: registro.dadosDepois }, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="numerico text-xs text-[var(--color-texto-3)]">
                      {registro.ip ?? "—"}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Paginacao
        pagina={pagina}
        totalPaginas={Math.max(1, Math.ceil(total / POR_PAGINA))}
        total={total}
        base="/auditoria"
        parametros={brutos}
      />
    </>
  );
}

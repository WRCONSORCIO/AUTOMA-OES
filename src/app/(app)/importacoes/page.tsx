import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  formatarBytes,
  formatarDataHora,
  formatarDuracao,
  formatarNumero,
} from "@/lib/format";
import { inteiro, type ParametrosBusca } from "@/lib/filtros";
import {
  Aviso,
  Badge,
  Cabecalho,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabela,
  TabelaVazia,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Paginacao } from "@/components/paginacao";
import { EnviarArquivo } from "./enviar-arquivo";

export const metadata: Metadata = { title: "Importações" };

const POR_PAGINA = 25;

const TOM_STATUS = {
  PENDENTE: "neutro",
  PROCESSANDO: "marca",
  CONCLUIDA: "bom",
  CONCLUIDA_COM_ERROS: "atencao",
  FALHA: "critico",
} as const;

export default async function PaginaImportacoes({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("importacoes");
  const brutos = await searchParams;
  const pagina = inteiro(brutos, "pagina", 1);

  const [importacoes, total, administradoras] = await Promise.all([
    prisma.importacao.findMany({
      include: {
        administradora: { select: { nome: true } },
        _count: { select: { erros: true } },
      },
      orderBy: { iniciadoEm: "desc" },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.importacao.count(),
    prisma.administradora.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const podeImportar = podeAcessar(sessao.perfil, "importacoes", "criar");

  return (
    <>
      <CabecalhoPagina
        titulo="Importações"
        descricao="Base de clientes (CSV) e relatórios de comissão (PDF). Toda importação fica registrada com usuário, data, hora e contadores."
      />

      {administradoras.length === 0 ? (
        <Aviso tom="atencao">
          Nenhuma administradora cadastrada. Rode a carga inicial (`npm run db:seed`) ou cadastre
          uma administradora antes de importar arquivos.
        </Aviso>
      ) : null}

      {podeImportar ? <EnviarArquivo administradoras={administradoras} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de importações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Data e hora</Th>
                <Th className="text-right">Duração</Th>
                <Th>Arquivo</Th>
                <Th>Tipo</Th>
                <Th>Administradora</Th>
                <Th>Usuário</Th>
                <Th className="text-right">Lidas</Th>
                <Th className="text-right">Criados</Th>
                <Th className="text-right">Atualizados</Th>
                <Th className="text-right">Duplicados</Th>
                <Th className="text-right">Cancelados</Th>
                <Th className="text-right">Contemplados</Th>
                <Th className="text-right">Erros</Th>
                <Th>Status</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {importacoes.length === 0 ? (
                <TabelaVazia colunas={14} mensagem="Nenhuma importação registrada." />
              ) : (
                importacoes.map((importacao) => (
                  <Tr key={importacao.id}>
                    <Td className="whitespace-nowrap">
                      {formatarDataHora(importacao.iniciadoEm)}
                    </Td>
                    {/*
                      Quanto o arquivo levou para entrar. É a métrica que diz se
                      a importação cabe no limite de execução do servidor — sem
                      ela, o dia em que passar a não caber só se descobre pelo
                      erro.
                    */}
                    <Td className="numerico whitespace-nowrap text-right">
                      {formatarDuracao(importacao.iniciadoEm, importacao.finalizadoEm)}
                    </Td>
                    <Td className="max-w-64 truncate" title={importacao.nomeArquivo}>
                      {importacao.nomeArquivo}
                      <span className="block text-xs text-[var(--color-texto-3)]">
                        {formatarBytes(importacao.tamanhoBytes)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tom="neutro">
                        {importacao.tipo === "BASE_CSV" ? "Base CSV" : "Comissão PDF"}
                      </Badge>
                    </Td>
                    <Td>{importacao.administradora?.nome ?? "—"}</Td>
                    <Td>{importacao.usuarioNome ?? "—"}</Td>
                    <Td className="numerico text-right">
                      {formatarNumero(importacao.totalLinhas)}
                    </Td>
                    <Td className="numerico text-right">{formatarNumero(importacao.qtdCriados)}</Td>
                    <Td className="numerico text-right">
                      {formatarNumero(importacao.qtdAtualizados)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarNumero(importacao.qtdDuplicados)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarNumero(importacao.qtdCancelados)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarNumero(importacao.qtdContemplados)}
                    </Td>
                    <Td className="numerico text-right">
                      {importacao.qtdErros > 0 ? (
                        <span className="text-[var(--color-critico)]">
                          {formatarNumero(importacao.qtdErros)}
                        </span>
                      ) : (
                        "0"
                      )}
                    </Td>
                    <Td>
                      <Badge tom={TOM_STATUS[importacao.status]}>
                        {importacao.status.replaceAll("_", " ")}
                      </Badge>
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
        base="/importacoes"
        parametros={brutos}
      />
    </>
  );
}

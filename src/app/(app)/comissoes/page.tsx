import Link from "next/link";
import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { formatarData, formatarMoeda, formatarNumero, formatarPercentual } from "@/lib/format";
import { inteiro, periodoPadrao, type ParametrosBusca } from "@/lib/filtros";
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
import { FiltrosPeriodo, lerParametrosFiltro } from "@/components/filtros-periodo";
import { Paginacao } from "@/components/paginacao";
import { BotaoRecalcular } from "./recalcular";

export const metadata: Metadata = { title: "Comissões WR" };

const POR_PAGINA = 50;

const ROTULO_TIPO = {
  PAGAMENTO_COMISSAO: "Pagamento Comissão",
  INCLUSAO_DE_PLANO: "Inclusão de Plano",
  CANCELAMENTO_DE_PLANO: "Cancelamento de Plano",
  OUTRO: "Outro",
} as const;

const TOM_TIPO = {
  PAGAMENTO_COMISSAO: "marca",
  INCLUSAO_DE_PLANO: "bom",
  CANCELAMENTO_DE_PLANO: "critico",
  OUTRO: "atencao",
} as const;

export default async function PaginaComissoes({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("comissoes");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, periodoPadrao());
  const pagina = inteiro(brutos, "pagina", 1);

  const de = parseDataBr(parametros.de);
  const ate = parseDataBr(parametros.ate);

  const where: Prisma.ComissaoRegistroWhereInput = {
    ...(de || ate
      ? { dataReferencia: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } }
      : {}),
    ...(parametros.administradora ? { administradoraId: parametros.administradora } : {}),
    ...(parametros.vendedor ? { vendedorId: parametros.vendedor } : {}),
    ...(parametros.tipo
      ? { tipo: parametros.tipo as keyof typeof ROTULO_TIPO }
      : {}),
    ...(escopo.gerenciaId ?? parametros.gerencia
      ? { gerenciaId: escopo.gerenciaId ?? parametros.gerencia }
      : {}),
    ...(escopo.equipeId ?? parametros.equipe
      ? { equipeId: escopo.equipeId ?? parametros.equipe }
      : {}),
    ...(parametros.q
      ? {
          OR: [
            { nomeCliente: { contains: parametros.q, mode: "insensitive" } },
            { contrato: { contains: parametros.q, mode: "insensitive" } },
            { grupo: { contains: parametros.q } },
            { cota: { contains: parametros.q } },
          ],
        }
      : {}),
  };

  const [registros, total, agregado, totalWr, administradoras, gerencias, equipes, vendedores] =
    await Promise.all([
      prisma.comissaoRegistro.findMany({
        where,
        include: {
          vendedor: { select: { id: true, nome: true } },
          equipe: { select: { nome: true } },
          gerencia: { select: { nome: true } },
          administradora: { select: { nome: true } },
          comissaoWr: true,
          cotaRef: { select: { id: true, situacao: true } },
        },
        orderBy: [{ dataReferencia: "desc" }, { ordemPdf: "asc" }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
      prisma.comissaoRegistro.count({ where }),
      prisma.comissaoRegistro.aggregate({ where, _sum: { valorComissao: true } }),
      prisma.comissaoWr.aggregate({
        where: { comissaoRegistro: where },
        _sum: { valor: true },
      }),
      prisma.administradora.findMany({
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      prisma.gerencia.findMany({
        where: escopo.gerenciaId ? { id: escopo.gerenciaId } : {},
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      prisma.equipe.findMany({
        where: {
          ...(escopo.equipeId ? { id: escopo.equipeId } : {}),
          ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
        },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      prisma.vendedor.findMany({
        where: {
          ...(escopo.equipeId ? { equipeId: escopo.equipeId } : {}),
          ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
        },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
    ]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <CabecalhoPagina
        titulo="Comissões WR"
        descricao="Todos os lançamentos importados dos relatórios de fechamento das administradoras, com a comissão interna calculada pela categoria da venda."
        acoes={podeAcessar(sessao.perfil, "comissoes", "editar") ? <BotaoRecalcular /> : null}
      />

      <FiltrosPeriodo
        acao="/comissoes"
        parametros={parametros}
        mostrarBusca
        opcoes={{
          administradoras,
          gerencias,
          equipes,
          vendedores,
          tipos: Object.entries(ROTULO_TIPO).map(([id, nome]) => ({ id, nome })),
        }}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Indicador rotulo="Lançamentos" valor={formatarNumero(total)} />
        <Indicador
          rotulo="Valor do relatório"
          valor={formatarMoeda(agregado._sum.valorComissao ?? 0)}
        />
        <Indicador
          rotulo="Comissão WR"
          valor={formatarMoeda(totalWr._sum.valor ?? 0)}
          detalhe="Somatório calculado pelas tabelas por categoria"
        />
      </section>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Cliente</Th>
                <Th>Grupo / Cota</Th>
                <Th>Contrato</Th>
                <Th>Vendedor</Th>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Administradora</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Parcela</Th>
                <Th className="text-right">Crédito</Th>
                <Th className="text-right">Flex</Th>
                <Th className="text-right">Valor</Th>
                <Th className="text-right">Comissão WR</Th>
                <Th>Data</Th>
                <Th>Status</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {registros.length === 0 ? (
                <TabelaVazia
                  colunas={15}
                  mensagem="Nenhum lançamento encontrado. Ajuste os filtros ou importe um relatório de comissão."
                />
              ) : (
                registros.map((registro) => (
                  <Tr key={registro.id}>
                    <Td className="max-w-64 truncate font-medium" title={registro.nomeCliente}>
                      {registro.cotaRef ? (
                        <Link
                          href={`/clientes/${registro.cotaRef.id}`}
                          className="text-[var(--color-marca-forte)] hover:underline"
                        >
                          {registro.nomeCliente}
                        </Link>
                      ) : (
                        registro.nomeCliente
                      )}
                    </Td>
                    <Td className="numerico whitespace-nowrap">
                      {registro.grupo} / {registro.cota}
                    </Td>
                    <Td className="numerico">{registro.contrato}</Td>
                    <Td className="max-w-48 truncate">
                      {registro.vendedor?.nome ?? registro.nomeVendedorRelatorio ?? "—"}
                      {registro.origemVendedor === "OVERRIDE_WR" ? (
                        <Badge tom="marca" className="ml-2">
                          WR
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>{registro.equipe?.nome ?? "—"}</Td>
                    <Td>{registro.gerencia?.nome ?? "—"}</Td>
                    <Td>{registro.administradora.nome}</Td>
                    <Td>
                      <Badge tom={TOM_TIPO[registro.tipo]}>{ROTULO_TIPO[registro.tipo]}</Badge>
                    </Td>
                    <Td className="numerico text-right">{registro.parcela}</Td>
                    <Td className="numerico text-right">{formatarMoeda(registro.valorCredito)}</Td>
                    <Td className="numerico text-right">
                      {registro.percentualFlex === null
                        ? "—"
                        : formatarPercentual(registro.percentualFlex)}
                    </Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(registro.valorComissao)}
                    </Td>
                    <Td className="numerico text-right">
                      {registro.comissaoWr && Number(registro.comissaoWr.valor) !== 0 ? (
                        formatarMoeda(registro.comissaoWr.valor)
                      ) : (
                        <span
                          className="text-[var(--color-texto-3)]"
                          title={registro.comissaoWr?.observacao ?? undefined}
                        >
                          —
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatarData(registro.dataReferencia)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tom={registro.status === "ESTORNO" ? "critico" : "neutro"}>
                          {registro.status === "ESTORNO" ? "Estorno" : "Normal"}
                        </Badge>
                        {registro.emRecuperacao ? <Badge tom="atencao">Recuperação</Badge> : null}
                        {registro.categoriaVenda ? (
                          <Badge tom="neutro">{registro.categoriaVenda}</Badge>
                        ) : (
                          <Badge tom="atencao">Sem categoria</Badge>
                        )}
                      </div>
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
        totalPaginas={totalPaginas}
        total={total}
        base="/comissoes"
        parametros={brutos}
      />
    </>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento, parseDataBr } from "@/lib/normalize";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/format";
import {
  digitosDaBusca,
  inteiro,
  periodoPadrao,
  type ParametrosBusca,
} from "@/lib/filtros";
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

export const metadata: Metadata = { title: "Clientes (cotas)" };

const POR_PAGINA = 50;

const TOM_SITUACAO = {
  ATIVO: "bom",
  CANCELADO: "critico",
  CONTEMPLADO: "marca",
  QUITADO: "neutro",
  TRANSFERIDO: "neutro",
  EM_ATRASO: "atencao",
  DESISTENTE: "grave",
  OUTRO: "neutro",
} as const;

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("cotas");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, { de: new Date(0), ate: new Date() });
  const pagina = inteiro(brutos, "pagina", 1);

  const de = brutos.de ? parseDataBr(parametros.de) : null;
  const ate = brutos.ate ? parseDataBr(parametros.ate) : null;

  const digitos = digitosDaBusca(parametros.q);

  const where: Prisma.CotaWhereInput = {
    ...(de || ate
      ? { dataVenda: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } }
      : {}),
    ...(parametros.administradora ? { administradoraId: parametros.administradora } : {}),
    // O filtro é da PESSOA, e alcança todos os documentos dela. Filtrar por
    // documento fazia a mesma pessoa aparecer duas vezes na lista e, escolhida
    // uma das entradas, escondia as vendas feitas pelo outro login sem avisar.
    ...(parametros.pessoa
      ? { vendedorEfetivo: { pessoaId: parametros.pessoa } }
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
            // Mesmo defeito que estava na tela de vendedores: sem os dígitos,
            // `contains: ""` casa com toda a carteira e anula o `OR` inteiro.
            ...(digitos ? [{ cpfCnpjCliente: { contains: digitos } }] : []),
          ],
        }
      : {}),
  };

  const [cotas, total, resumo, administradoras, gerencias, equipes, pessoas] =
    await Promise.all([
      prisma.cota.findMany({
        where,
        select: {
          id: true,
          nomeCliente: true,
          cpfCnpjCliente: true,
          contrato: true,
          grupo: true,
          cota: true,
          dataVenda: true,
          situacao: true,
          valorCredito: true,
          taxaFlex: true,
          parcelasPagas: true,
          contemplado: true,
          emRecuperacao: true,
          geraEstorno: true,
          categoriaVenda: true,
          origemVendedor: true,
          administradora: { select: { nome: true } },
          vendedorEfetivo: {
            select: { nome: true, pessoa: { select: { nome: true } } },
          },
          equipe: { select: { nome: true } },
          gerencia: { select: { nome: true } },
        },
        orderBy: [{ dataVenda: "desc" }, { criadoEm: "desc" }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
      prisma.cota.count({ where }),
      prisma.cota.aggregate({ where, _sum: { valorCredito: true } }),
      prisma.administradora.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
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
      // Uma entrada por PESSOA. A lista antes vinha de `Vendedor`, e por isso
      // repetia quem tem CPF e CNPJ — foi o que apareceu na tela: o mesmo nome
      // duas vezes, às vezes com grafias ligeiramente diferentes.
      prisma.pessoa.findMany({
        where: {
          documentos: {
            some: {
              ...(escopo.equipeId ? { equipeId: escopo.equipeId } : {}),
              ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
            },
          },
        },
        select: { id: true, nome: true, _count: { select: { documentos: true } } },
        orderBy: { nome: "asc" },
      }),
    ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Clientes (cotas)"
        descricao="Cada cota é um cliente independente. A base é alimentada exclusivamente pela importação do arquivo da administradora — não há cadastro manual."
      />

      <FiltrosPeriodo
        acao="/clientes"
        parametros={parametros}
        mostrarBusca
        opcoes={{
          administradoras,
          gerencias,
          equipes,
          pessoas: pessoas.map((pessoa) => ({
            id: pessoa.id,
            // O número de documentos vai no rótulo porque muda o que a escolha
            // significa: com dois, a seleção soma dois logins.
            nome:
              pessoa._count.documentos > 1
                ? `${pessoa.nome} (${pessoa._count.documentos} documentos)`
                : pessoa.nome,
          })),
        }}
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <Indicador rotulo="Cotas encontradas" valor={formatarNumero(total)} />
        <Indicador
          rotulo="Crédito somado"
          valor={formatarMoeda(resumo._sum.valorCredito ?? 0)}
        />
      </section>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Cliente</Th>
                <Th>CPF/CNPJ</Th>
                <Th>Grupo / Cota</Th>
                <Th>Contrato</Th>
                <Th>Administradora</Th>
                <Th>Vendedor</Th>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Venda</Th>
                <Th className="text-right">Crédito</Th>
                <Th className="text-right">Pagas</Th>
                <Th>Situação</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {cotas.length === 0 ? (
                <TabelaVazia
                  colunas={12}
                  mensagem="Nenhuma cota encontrada. Importe a base da administradora em Importações."
                />
              ) : (
                cotas.map((cota) => (
                  <Tr key={cota.id}>
                    <Td className="max-w-64 truncate font-medium">
                      <Link
                        href={`/clientes/${cota.id}`}
                        className="text-[var(--color-marca-forte)] hover:underline"
                      >
                        {cota.nomeCliente}
                      </Link>
                    </Td>
                    <Td className="numerico whitespace-nowrap">
                      {formatarDocumento(cota.cpfCnpjCliente)}
                    </Td>
                    <Td className="numerico whitespace-nowrap">
                      {cota.grupo} / {cota.cota}
                    </Td>
                    <Td className="numerico">{cota.contrato}</Td>
                    <Td>{cota.administradora.nome}</Td>
                    {/*
                      A pessoa em cima, o login usado embaixo. A venda é da
                      pessoa; por qual documento ela entrou continua importando
                      para a comissão, mas é detalhe da venda, não a identidade
                      de quem vendeu.
                    */}
                    <Td className="max-w-44">
                      <span className="block truncate">
                        {cota.vendedorEfetivo?.pessoa?.nome ??
                          cota.vendedorEfetivo?.nome ??
                          "—"}
                        {cota.origemVendedor === "OVERRIDE_WR" ? (
                          <Badge tom="marca" className="ml-2">
                            WR
                          </Badge>
                        ) : null}
                      </span>
                      {cota.vendedorEfetivo?.pessoa &&
                      cota.vendedorEfetivo.pessoa.nome !== cota.vendedorEfetivo.nome ? (
                        <span className="block truncate text-xs text-[var(--color-texto-3)]">
                          {cota.vendedorEfetivo.nome}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{cota.equipe?.nome ?? "—"}</Td>
                    <Td>{cota.gerencia?.nome ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatarData(cota.dataVenda)}</Td>
                    <Td className="numerico text-right">{formatarMoeda(cota.valorCredito)}</Td>
                    <Td className="numerico text-right">{cota.parcelasPagas}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tom={TOM_SITUACAO[cota.situacao]}>{cota.situacao}</Badge>
                        {cota.contemplado ? <Badge tom="marca">Contemplado</Badge> : null}
                        {cota.emRecuperacao ? <Badge tom="atencao">Recuperação</Badge> : null}
                        {cota.geraEstorno ? <Badge tom="critico">Estorno</Badge> : null}
                        {cota.categoriaVenda ? (
                          <Badge tom="neutro">{cota.categoriaVenda}</Badge>
                        ) : null}
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
        totalPaginas={Math.max(1, Math.ceil(total / POR_PAGINA))}
        total={total}
        base="/clientes"
        parametros={brutos}
      />
    </>
  );
}

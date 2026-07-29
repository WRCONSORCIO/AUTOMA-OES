import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento } from "@/lib/normalize";
import { formatarData, formatarDataHora, formatarMoeda, formatarNumero } from "@/lib/format";
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
import { Indicador } from "@/components/indicador";
import { PainelVendedor } from "./painel";

export const metadata: Metadata = { title: "Vendedor" };

export default async function PaginaVendedor({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPermissao("vendedores");
  const escopo = escopoDoUsuario(sessao);
  const { id } = await params;

  const vendedor = await prisma.vendedor.findUnique({
    where: { id },
    include: {
      equipe: { select: { id: true, nome: true } },
      gerencia: { select: { id: true, nome: true } },
      historicoCategorias: { orderBy: { vigenteDe: "desc" } },
      historicoAlocacoes: {
        orderBy: { vigenteDe: "desc" },
        include: { equipe: { select: { nome: true } }, gerencia: { select: { nome: true } } },
      },
      recuperacoes: { orderBy: { dataInicio: "desc" } },
    },
  });

  if (!vendedor) notFound();
  if (escopo.gerenciaId && vendedor.gerenciaId !== escopo.gerenciaId) notFound();
  if (escopo.equipeId && vendedor.equipeId !== escopo.equipeId) notFound();

  const [resumoCotas, comissaoWr, cotasRecuperacao, equipes, gerencias] = await Promise.all([
    prisma.cota.aggregate({
      where: { vendedorEfetivoId: id },
      _count: { _all: true },
      _sum: { valorCredito: true },
    }),
    prisma.comissaoWr.aggregate({
      where: { comissaoRegistro: { vendedorId: id } },
      _sum: { valor: true },
    }),
    prisma.cota.count({ where: { vendedorEfetivoId: id, emRecuperacao: true } }),
    prisma.equipe.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true, gerencia: { select: { id: true, nome: true } } },
      orderBy: { nome: "asc" },
    }),
    prisma.gerencia.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const podeEditar = podeAcessar(sessao.perfil, "vendedores", "editar");
  const semHistoricoCategoria = vendedor.historicoCategorias.length === 0;

  return (
    <>
      <Link
        href="/vendedores"
        className="inline-flex w-fit items-center gap-2 text-sm text-[var(--color-texto-2)] hover:text-[var(--color-texto)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para vendedores
      </Link>

      <CabecalhoPagina
        titulo={vendedor.nome}
        descricao={`${formatarDocumento(vendedor.cpfCnpj)} · ${vendedor.gerencia?.nome ?? "sem gerência"} · ${vendedor.equipe?.nome ?? "sem equipe"}`}
        acoes={
          <>
            <Badge tom={vendedor.categoriaAtual === "EXPERT" ? "bom" : "marca"}>
              {vendedor.categoriaAtual}
            </Badge>
            <Badge tom={vendedor.situacao === "ATIVO" ? "bom" : "neutro"}>
              {vendedor.situacao}
            </Badge>
          </>
        }
      />

      {semHistoricoCategoria ? (
        <Aviso tom="atencao">
          Este vendedor foi criado automaticamente pela importação e ainda não tem histórico de
          categoria. Enquanto não houver uma categoria vigente, as vendas dele não geram comissão
          WR. Registre a categoria abaixo com a data de início correta.
        </Aviso>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Cotas atribuídas" valor={formatarNumero(resumoCotas._count._all)} />
        <Indicador
          rotulo="Crédito vendido"
          valor={formatarMoeda(resumoCotas._sum.valorCredito ?? 0)}
        />
        <Indicador rotulo="Comissão WR gerada" valor={formatarMoeda(comissaoWr._sum.valor ?? 0)} />
        <Indicador
          rotulo="Vendas em recuperação"
          valor={formatarNumero(cotasRecuperacao)}
          tom={cotasRecuperacao > 0 ? "atencao" : "neutro"}
        />
      </section>

      {podeEditar ? (
        <PainelVendedor
          vendedor={{
            id: vendedor.id,
            nome: vendedor.nome,
            situacao: vendedor.situacao,
            observacoes: vendedor.observacoes,
            dataEntradaWr: vendedor.dataEntradaWr
              ? vendedor.dataEntradaWr.toISOString().slice(0, 10)
              : "",
            equipeId: vendedor.equipeId,
            gerenciaId: vendedor.gerenciaId,
            categoriaAtual: vendedor.categoriaAtual,
          }}
          equipes={equipes}
          gerencias={gerencias}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de categoria</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Nada é apagado. A categoria vigente na data da venda é a que vale para o cálculo,
            para sempre.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Categoria</Th>
                <Th>Vigente de</Th>
                <Th>Vigente até</Th>
                <Th>Motivo</Th>
                <Th>Registrado em</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {vendedor.historicoCategorias.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhuma categoria registrada." />
              ) : (
                vendedor.historicoCategorias.map((periodo) => (
                  <Tr key={periodo.id}>
                    <Td>
                      <Badge tom="marca">{periodo.categoria}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatarData(periodo.vigenteDe)}</Td>
                    <Td className="whitespace-nowrap">
                      {periodo.vigenteAte ? formatarData(periodo.vigenteAte) : "Vigente"}
                    </Td>
                    <Td>{periodo.motivo ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatarDataHora(periodo.criadoEm)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Períodos de recuperação</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Toda venda realizada dentro do intervalo fica marcada permanentemente, mesmo depois
            que a recuperação termina.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Início</Th>
                <Th>Fim</Th>
                <Th>Motivo</Th>
                <Th>Registrado em</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {vendedor.recuperacoes.length === 0 ? (
                <TabelaVazia colunas={4} mensagem="Nenhum período de recuperação registrado." />
              ) : (
                vendedor.recuperacoes.map((periodo) => (
                  <Tr key={periodo.id}>
                    <Td className="whitespace-nowrap">{formatarData(periodo.dataInicio)}</Td>
                    <Td className="whitespace-nowrap">{formatarData(periodo.dataFim)}</Td>
                    <Td>{periodo.motivo ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatarDataHora(periodo.criadoEm)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de equipe e gerência</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Vigente de</Th>
                <Th>Vigente até</Th>
                <Th>Motivo</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {vendedor.historicoAlocacoes.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhuma alocação registrada." />
              ) : (
                vendedor.historicoAlocacoes.map((periodo) => (
                  <Tr key={periodo.id}>
                    <Td>{periodo.equipe?.nome ?? "—"}</Td>
                    <Td>{periodo.gerencia?.nome ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatarData(periodo.vigenteDe)}</Td>
                    <Td className="whitespace-nowrap">
                      {periodo.vigenteAte ? formatarData(periodo.vigenteAte) : "Vigente"}
                    </Td>
                    <Td>{periodo.motivo ?? "—"}</Td>
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

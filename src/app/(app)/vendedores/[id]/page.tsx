import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento } from "@/lib/normalize";
import {
  formatarData,
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
} from "@/lib/format";
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
import { carregarFichaPessoa } from "@/server/services/pessoas";
import { carregarComissoesDaPessoa } from "@/server/services/comissao-equipe";
import { PainelVendedor } from "./painel";
import { BotaoSeparar } from "../../vinculos/formularios";

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
      pessoa: {
        select: {
          id: true,
          nome: true,
          historicoCategorias: { orderBy: { vigenteDe: "desc" } },
          recuperacoes: { orderBy: { dataInicio: "desc" } },
          vinculos: { orderBy: { criadoEm: "desc" }, take: 20 },
        },
      },
      historicoAlocacoes: {
        orderBy: { vigenteDe: "desc" },
        include: { equipe: { select: { nome: true } }, gerencia: { select: { nome: true } } },
      },
    },
  });

  if (!vendedor) notFound();
  if (escopo.gerenciaId && vendedor.gerenciaId !== escopo.gerenciaId) notFound();
  if (escopo.equipeId && vendedor.equipeId !== escopo.equipeId) notFound();

  const ficha = vendedor.pessoa ? await carregarFichaPessoa(vendedor.pessoa.id) : null;
  const documentosDaPessoa = ficha?.documentos.map((documento) => documento.vendedorId) ?? [id];

  const [resumoCotas, comissaoWr, cotasRecuperacao, equipes, gerencias, comissoesEquipe] =
    await Promise.all([
    prisma.cota.aggregate({
      where: { vendedorEfetivoId: { in: documentosDaPessoa } },
      _count: { _all: true },
      _sum: { valorCredito: true },
    }),
    prisma.comissaoWr.aggregate({
      where: { comissaoRegistro: { vendedorId: { in: documentosDaPessoa } } },
      _sum: { valor: true },
    }),
    prisma.cota.count({
      where: { vendedorEfetivoId: { in: documentosDaPessoa }, emRecuperacao: true },
    }),
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
    vendedor.pessoa ? carregarComissoesDaPessoa(vendedor.pessoa.id) : Promise.resolve([]),
  ]);

  const totalPrevisto = comissoesEquipe.reduce((soma, linha) => soma + linha.previsto, 0);
  const totalLiberado = comissoesEquipe.reduce((soma, linha) => soma + linha.liberado, 0);

  const podeEditar = podeAcessar(sessao.perfil, "vendedores", "editar");
  const historicoCategorias = vendedor.pessoa?.historicoCategorias ?? [];
  const recuperacoes = vendedor.pessoa?.recuperacoes ?? [];
  const semHistoricoCategoria = historicoCategorias.length === 0;

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
        <Indicador
          rotulo="Cotas atribuídas"
          valor={formatarNumero(resumoCotas._count._all)}
          detalhe={
            documentosDaPessoa.length > 1
              ? `Somando ${documentosDaPessoa.length} documentos da pessoa`
              : undefined
          }
        />
        <Indicador
          rotulo="Crédito vendido"
          valor={formatarMoeda(resumoCotas._sum.valorCredito ?? 0)}
        />
        <Indicador rotulo="Comissão WR gerada" valor={formatarMoeda(comissaoWr._sum.valor ?? 0)} />
        <Indicador
          rotulo="Comissão a receber"
          valor={formatarMoeda(totalPrevisto)}
          detalhe={`${formatarMoeda(totalLiberado)} já liberados pelas parcelas recebidas`}
          tom={totalPrevisto > 0 ? "bom" : "neutro"}
        />
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

      {ficha && ficha.documentos.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Documentos desta pessoa</CardTitle>
            <p className="text-sm text-[var(--color-texto-2)]">
              O vendedor começa no CPF e passa a operar por CNPJ ao mudar de categoria. Categoria
              e recuperação valem para todos os documentos abaixo.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Tabela>
              <Cabecalho>
                <tr>
                  <Th>Documento</Th>
                  <Th>Nome no cadastro</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Vendas</Th>
                  <Th className="text-right">Crédito</Th>
                  <Th className="text-right">Comissão WR</Th>
                  {podeEditar && ficha.documentos.length > 1 ? <Th>Ações</Th> : null}
                </tr>
              </Cabecalho>
              <tbody>
                {ficha.documentos.map((documento) => (
                  <Tr key={documento.vendedorId}>
                    <Td className="whitespace-nowrap">
                      <Badge tom={documento.tipo === "CPF" ? "marca" : "neutro"}>
                        {documento.tipo}
                      </Badge>
                      <span className="numerico ml-2">
                        {formatarDocumento(documento.cpfCnpj)}
                      </span>
                    </Td>
                    <Td>
                      {documento.vendedorId === vendedor.id ? (
                        <strong>{documento.nome}</strong>
                      ) : (
                        <Link
                          href={`/vendedores/${documento.vendedorId}`}
                          className="text-[var(--color-marca-forte)] hover:underline"
                        >
                          {documento.nome}
                        </Link>
                      )}
                    </Td>
                    <Td>{documento.situacao}</Td>
                    <Td className="numerico text-right">{formatarNumero(documento.cotas)}</Td>
                    <Td className="numerico text-right">{formatarMoeda(documento.credito)}</Td>
                    <Td className="numerico text-right">
                      {formatarMoeda(documento.comissaoWr)}
                    </Td>
                    {podeEditar && ficha.documentos.length > 1 ? (
                      <Td>
                        <BotaoSeparar vendedorId={documento.vendedorId} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
                <Tr className="font-medium">
                  <Td colSpan={3}>Total da pessoa</Td>
                  <Td className="numerico text-right">{formatarNumero(ficha.totalCotas)}</Td>
                  <Td className="numerico text-right">{formatarMoeda(ficha.totalCredito)}</Td>
                  <Td className="numerico text-right">
                    {formatarMoeda(ficha.totalComissaoWr)}
                  </Td>
                  {podeEditar && ficha.documentos.length > 1 ? <Td /> : null}
                </Tr>
              </tbody>
            </Tabela>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Comissão desta pessoa, venda a venda</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Cada linha usa o percentual da tabela vigente para a categoria daquela venda. O
            liberado acompanha as parcelas que a WR já recebeu da administradora.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Venda</Th>
                <Th>Cliente</Th>
                <Th>Data</Th>
                <Th>Categoria</Th>
                <Th className="text-right">Base</Th>
                <Th className="text-right">%</Th>
                <Th className="text-right">Previsto</Th>
                <Th className="text-right">Liberado</Th>
                <Th className="text-right">Parcelas</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {comissoesEquipe.length === 0 ? (
                <TabelaVazia
                  colunas={9}
                  mensagem="Nenhuma comissão apurada. Verifique se há categoria no histórico e tabela de comissão da equipe vigente."
                />
              ) : (
                comissoesEquipe.map((linha) => (
                  <Tr key={linha.cotaId}>
                    <Td className="numerico whitespace-nowrap">
                      <Link
                        href={`/clientes/${linha.cotaId}`}
                        className="text-[var(--color-marca-forte)] hover:underline"
                      >
                        {linha.grupo}-{linha.cota}
                      </Link>
                    </Td>
                    <Td>{linha.nomeCliente}</Td>
                    <Td className="whitespace-nowrap">{formatarData(linha.dataVenda)}</Td>
                    <Td>
                      <Badge tom="marca">{linha.categoriaVenda}</Badge>
                    </Td>
                    <Td className="numerico text-right">{formatarMoeda(linha.baseCalculo)}</Td>
                    <Td className="numerico text-right">{formatarPercentual(linha.percentual)}</Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(linha.previsto)}
                    </Td>
                    <Td className="numerico text-right text-[var(--color-bom)]">
                      {formatarMoeda(linha.liberado)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarNumero(linha.parcelasRecebidas)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

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
              {historicoCategorias.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhuma categoria registrada." />
              ) : (
                historicoCategorias.map((periodo) => (
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
              {recuperacoes.length === 0 ? (
                <TabelaVazia colunas={4} mensagem="Nenhum período de recuperação registrado." />
              ) : (
                recuperacoes.map((periodo) => (
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

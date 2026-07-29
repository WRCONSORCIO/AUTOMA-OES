import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento } from "@/lib/normalize";
import { formatarData, formatarDataHora, formatarMoeda, formatarPercentual } from "@/lib/format";
import {
  Aviso,
  Badge,
  CabecalhoPagina,
  Cabecalho,
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
import { FormularioTransferencia } from "./transferencia";

export const metadata: Metadata = { title: "Detalhe da cota" };

export default async function PaginaCota({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPermissao("cotas");
  const escopo = escopoDoUsuario(sessao);
  const { id } = await params;

  const cota = await prisma.cota.findUnique({
    where: { id },
    include: {
      administradora: true,
      vendedorEfetivo: { select: { id: true, nome: true, categoriaAtual: true } },
      vendedorAdm: { select: { id: true, nome: true } },
      equipe: { select: { nome: true } },
      gerencia: { select: { nome: true } },
      recuperacao: true,
      estorno: true,
      override: { select: { id: true, motivo: true, criadoEm: true } },
      overrideHistorico: { orderBy: { criadoEm: "desc" } },
      versoes: { orderBy: { criadoEm: "desc" }, take: 20, select: { id: true, criadoEm: true, importacaoId: true } },
      comissoes: {
        orderBy: { dataReferencia: "desc" },
        include: { comissaoWr: true },
      },
    },
  });

  if (!cota) notFound();

  // Um gerente/supervisor só abre cotas do próprio escopo.
  if (escopo.gerenciaId && cota.gerenciaId !== escopo.gerenciaId) notFound();
  if (escopo.equipeId && cota.equipeId !== escopo.equipeId) notFound();

  const podeTransferir = podeAcessar(sessao.perfil, "transferencias", "editar");

  const vendedores = podeTransferir
    ? await prisma.vendedor.findMany({
        where: { situacao: "ATIVO" },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      })
    : [];

  return (
    <>
      <Link
        href="/clientes"
        className="inline-flex w-fit items-center gap-2 text-sm text-[var(--color-texto-2)] hover:text-[var(--color-texto)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para clientes
      </Link>

      <CabecalhoPagina
        titulo={cota.nomeCliente}
        descricao={`${cota.administradora.nome} · Contrato ${cota.contrato} · Grupo ${cota.grupo} · Cota ${cota.cota}`}
      />

      <div className="flex flex-wrap gap-2">
        <Badge tom={cota.situacao === "ATIVO" ? "bom" : cota.situacao === "CANCELADO" ? "critico" : "neutro"}>
          {cota.situacao}
        </Badge>
        {cota.contemplado ? <Badge tom="marca">Contemplado</Badge> : null}
        {cota.emRecuperacao ? <Badge tom="atencao">Venda em recuperação</Badge> : null}
        {cota.geraEstorno ? <Badge tom="critico">Gera estorno</Badge> : null}
        {cota.categoriaVenda ? (
          <Badge tom="neutro">Categoria da venda: {cota.categoriaVenda}</Badge>
        ) : (
          <Badge tom="atencao">Categoria da venda não definida</Badge>
        )}
      </div>

      {cota.emRecuperacao ? (
        <Aviso tom="atencao">
          Esta venda foi realizada durante um período de recuperação do vendedor. A marcação é
          permanente e continua valendo mesmo que a recuperação seja encerrada.
          {cota.recuperacao
            ? ` Período: ${formatarData(cota.recuperacao.dataInicio)} a ${formatarData(cota.recuperacao.dataFim)}.`
            : null}
        </Aviso>
      ) : null}

      {cota.estorno ? (
        <Aviso tom="critico">
          Estorno gerado: {cota.estorno.motivo} Cancelamento em{" "}
          {formatarData(cota.estorno.dataCancelamento)}.
        </Aviso>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Dados da cota</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dado rotulo="CPF/CNPJ do cliente" valor={formatarDocumento(cota.cpfCnpjCliente)} />
            <Dado rotulo="Contato" valor={cota.contatoCliente ?? "—"} />
            <Dado rotulo="E-mail" valor={cota.emailCliente ?? "—"} />
            <Dado rotulo="UF" valor={cota.ufCliente ?? "—"} />
            <Dado rotulo="Data da venda" valor={formatarData(cota.dataVenda)} />
            <Dado rotulo="Data de entrada" valor={formatarData(cota.dataEntrada)} />
            <Dado rotulo="Produto" valor={cota.produto ?? "—"} />
            <Dado rotulo="Segmento" valor={cota.segmento ?? "—"} />
            <Dado rotulo="Crédito" valor={formatarMoeda(cota.valorCredito)} />
            <Dado rotulo="Parcela" valor={formatarMoeda(cota.valorParcela)} />
            <Dado
              rotulo="Flex"
              valor={cota.temFlex && cota.taxaFlex ? formatarPercentual(cota.taxaFlex) : "Integral"}
            />
            <Dado rotulo="Prazo" valor={cota.prazo ? `${cota.prazo} meses` : "—"} />
            <Dado rotulo="Parcelas pagas" valor={String(cota.parcelasPagas)} />
            <Dado rotulo="Último pagamento" valor={formatarData(cota.dataUltimoPagamento)} />
            <Dado rotulo="Contemplação" valor={formatarData(cota.dataContemplacao)} />
            <Dado rotulo="Cancelamento" valor={formatarData(cota.dataCancelamento)} />
            <Dado rotulo="Situação na administradora" valor={cota.situacaoOriginal ?? "—"} />
            <Dado rotulo="Origem da venda" valor={cota.origemVenda ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atribuição comercial</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Dado
              rotulo="Vendedor efetivo"
              valor={cota.vendedorEfetivo?.nome ?? "Não identificado"}
              destaque={
                cota.origemVendedor === "OVERRIDE_WR" ? "Override interno WR" : "Base da administradora"
              }
            />
            <Dado
              rotulo="Vendedor na administradora"
              valor={cota.nomeVendedorAdm ?? cota.vendedorAdm?.nome ?? "—"}
              destaque={
                cota.cpfCnpjVendedorAdm ? formatarDocumento(cota.cpfCnpjVendedorAdm) : undefined
              }
            />
            <Dado rotulo="Equipe" valor={cota.equipe?.nome ?? "—"} />
            <Dado rotulo="Gerência" valor={cota.gerencia?.nome ?? "—"} />
            {cota.override ? (
              <Dado
                rotulo="Motivo do override"
                valor={cota.override.motivo ?? "—"}
                destaque={formatarDataHora(cota.override.criadoEm)}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {podeTransferir ? (
        <Card>
          <CardHeader>
            <CardTitle>Transferência de vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <FormularioTransferencia
              cotaId={cota.id}
              vendedores={vendedores}
              temOverride={Boolean(cota.override)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de transferências</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Data e hora</Th>
                <Th>Usuário</Th>
                <Th>Vendedor anterior</Th>
                <Th>Novo vendedor</Th>
                <Th>Motivo</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {cota.overrideHistorico.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhuma transferência registrada." />
              ) : (
                cota.overrideHistorico.map((registro) => (
                  <Tr key={registro.id}>
                    <Td className="whitespace-nowrap">{formatarDataHora(registro.criadoEm)}</Td>
                    <Td>{registro.usuarioNome ?? "—"}</Td>
                    <Td>{registro.vendedorAnteriorNome ?? "—"}</Td>
                    <Td className="font-medium">{registro.vendedorNovoNome ?? "—"}</Td>
                    <Td className="max-w-96">{registro.motivo}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lançamentos de comissão desta cota</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Data</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Parcela</Th>
                <Th className="text-right">Crédito</Th>
                <Th className="text-right">Flex</Th>
                <Th className="text-right">Valor</Th>
                <Th className="text-right">Comissão WR</Th>
                <Th>Regra</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {cota.comissoes.length === 0 ? (
                <TabelaVazia colunas={8} mensagem="Nenhum lançamento importado para esta cota." />
              ) : (
                cota.comissoes.map((lancamento) => (
                  <Tr key={lancamento.id}>
                    <Td className="whitespace-nowrap">{formatarData(lancamento.dataReferencia)}</Td>
                    <Td>{lancamento.tipoOriginal}</Td>
                    <Td className="numerico text-right">{lancamento.parcela}</Td>
                    <Td className="numerico text-right">{formatarMoeda(lancamento.valorCredito)}</Td>
                    <Td className="numerico text-right">
                      {lancamento.percentualFlex === null
                        ? "—"
                        : formatarPercentual(lancamento.percentualFlex)}
                    </Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(lancamento.valorComissao)}
                    </Td>
                    <Td className="numerico text-right">
                      {lancamento.comissaoWr ? formatarMoeda(lancamento.comissaoWr.valor) : "—"}
                    </Td>
                    <Td className="text-xs text-[var(--color-texto-2)]">
                      {lancamento.comissaoWr?.observacao ?? lancamento.comissaoWr?.regra ?? "—"}
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
          <CardTitle>Versões recebidas da administradora</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Cada importação que alterou a cota gera uma versão. Nada é sobrescrito.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Registrada em</Th>
                <Th>Importação</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {cota.versoes.length === 0 ? (
                <TabelaVazia colunas={2} mensagem="Sem versões registradas." />
              ) : (
                cota.versoes.map((versao) => (
                  <Tr key={versao.id}>
                    <Td>{formatarDataHora(versao.criadoEm)}</Td>
                    <Td className="numerico text-xs">{versao.importacaoId ?? "—"}</Td>
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

function Dado({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--color-texto-3)]">{rotulo}</p>
      <p className="mt-0.5 text-sm font-medium">{valor}</p>
      {destaque ? <p className="text-xs text-[var(--color-texto-2)]">{destaque}</p> : null}
    </div>
  );
}

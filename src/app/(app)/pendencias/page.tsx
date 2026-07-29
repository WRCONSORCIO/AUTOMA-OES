import type { Metadata } from "next";
import { CircleCheckBig, TriangleAlert } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/format";
import { formatarDocumento } from "@/lib/normalize";
import { carregarPendenciasCadastro } from "@/server/services/pendencias";
import {
  Aviso,
  Badge,
  Cabecalho,
  CabecalhoPagina,
  Card,
  CardContent,
  Tabela,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { LinhaPendencia } from "./formularios";

export const metadata: Metadata = { title: "Pendências de cadastro" };

export default async function PaginaPendencias() {
  const sessao = await exigirPermissao("vendedores");
  const escopo = escopoDoUsuario(sessao);
  const podeResolver = podeAcessar(sessao.perfil, "vendedores", "editar");

  const [resumo, equipes, gerencias] = await Promise.all([
    carregarPendenciasCadastro(escopo),
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

  if (resumo.itens.length === 0) {
    return (
      <>
        <CabecalhoPagina
          titulo="Pendências de cadastro"
          descricao="Vendedores cujas vendas ainda não geram comissão WR por falta de categoria vigente na data da venda."
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-bom)_15%,transparent)]">
              <CircleCheckBig className="h-6 w-6 text-[var(--color-bom)]" />
            </span>
            <div>
              <p className="font-medium">Nenhuma pendência</p>
              <p className="mt-1 text-sm text-[var(--color-texto-2)]">
                Todas as vendas importadas têm categoria definida na data em que foram feitas.
              </p>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Pendências de cadastro"
        descricao="Vendedores cujas vendas ainda não geram comissão WR por falta de categoria vigente na data da venda."
      />

      <Aviso tom="atencao">
        O sistema não atribui categoria por conta própria: sem categoria vigente na data da venda,
        a comissão WR não é calculada. Defina a categoria e a data de início corretas — o
        recálculo roda automaticamente e libera os lançamentos travados.
      </Aviso>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Vendedores pendentes"
          valor={formatarNumero(resumo.totalVendedores)}
          icone={<TriangleAlert className="h-4 w-4" />}
          tom="atencao"
        />
        <Indicador rotulo="Vendas sem categoria" valor={formatarNumero(resumo.totalCotas)} />
        <Indicador
          rotulo="Lançamentos travados"
          valor={formatarNumero(resumo.totalLancamentos)}
        />
        <Indicador
          rotulo="Valor sem comissão calculada"
          valor={formatarMoeda(resumo.valorTotalBloqueado)}
          detalhe="Valor pago pela administradora nesses lançamentos"
          tom="critico"
        />
      </section>

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Vendedor</Th>
                <Th>Situação</Th>
                <Th>Gerência</Th>
                <Th>Equipe</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Lançamentos</Th>
                <Th className="text-right">Valor travado</Th>
                <Th>Período das vendas</Th>
                {podeResolver ? <Th>Ação</Th> : null}
              </tr>
            </Cabecalho>
            <tbody>
              {resumo.itens.map((pendencia) =>
                podeResolver ? (
                  <LinhaPendencia
                    key={pendencia.vendedorId}
                    pendencia={{
                      ...pendencia,
                      primeiraVenda: pendencia.primeiraVenda?.toISOString() ?? null,
                      ultimaVenda: pendencia.ultimaVenda?.toISOString() ?? null,
                    }}
                    equipes={equipes}
                    gerencias={gerencias}
                  />
                ) : (
                  <Tr key={pendencia.vendedorId}>
                    <Td className="font-medium">
                      {pendencia.nome}
                      <span className="mt-0.5 block text-xs font-normal text-[var(--color-texto-3)]">
                        {formatarDocumento(pendencia.cpfCnpj)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tom={pendencia.temHistoricoCategoria ? "neutro" : "critico"}>
                        {pendencia.temHistoricoCategoria
                          ? "Vendas antes da vigência"
                          : "Sem categoria"}
                      </Badge>
                    </Td>
                    <Td>{pendencia.gerenciaNome ?? "—"}</Td>
                    <Td>{pendencia.equipeNome ?? "—"}</Td>
                    <Td className="numerico text-right">
                      {formatarNumero(pendencia.cotasSemCategoria)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarNumero(pendencia.lancamentosBloqueados)}
                    </Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(pendencia.valorBloqueado)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatarData(pendencia.primeiraVenda)} →{" "}
                      {formatarData(pendencia.ultimaVenda)}
                    </Td>
                  </Tr>
                ),
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

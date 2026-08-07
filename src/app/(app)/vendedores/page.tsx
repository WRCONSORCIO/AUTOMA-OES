import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { UserPlus } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento } from "@/lib/normalize";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/format";
import { inteiro, texto, type ParametrosBusca } from "@/lib/filtros";
import {
  Aviso,
  Badge,
  Cabecalho,
  CabecalhoPagina,
  Campo,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Entrada,
  Selecao,
  Tabela,
  TabelaVazia,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Paginacao } from "@/components/paginacao";
import { NovoVendedor } from "./novo-vendedor";
import { avaliarPessoas } from "@/modules/comercial/application/use-cases/aptos-promocao";
import { categoriaDaPessoa } from "@/modules/comercial/domain/rules/promocao";

export const metadata: Metadata = { title: "Vendedores" };

const POR_PAGINA = 50;

const TOM_CATEGORIA = {
  INICIANTE: "atencao",
  VETERANO: "marca",
  EXPERT: "bom",
} as const;

/**
 * A lista é de pessoas, não de documentos.
 *
 * Quem vende no CPF e no CNPJ é uma pessoa só: aparecer duas vezes aqui
 * confunde e faz as vendas da mesma pessoa parecerem de gente diferente. A
 * quebra por documento continua na ficha, a um clique.
 */
export default async function PaginaVendedores({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("vendedores");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const pagina = inteiro(brutos, "pagina", 1);
  const busca = texto(brutos, "q");
  const categoria = texto(brutos, "categoria");
  const situacao = texto(brutos, "situacao");

  // Os filtros valem sobre os documentos: basta um deles atender para a pessoa
  // entrar na lista.
  const filtroDocumento: Prisma.VendedorWhereInput = {
    ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
    ...(escopo.equipeId ? { equipeId: escopo.equipeId } : {}),
    ...(categoria ? { categoriaAtual: categoria as "INICIANTE" } : {}),
    ...(situacao ? { situacao: situacao as "ATIVO" } : {}),
    ...(busca
      ? {
          OR: [
            { nome: { contains: busca, mode: "insensitive" } },
            { cpfCnpj: { contains: busca.replace(/\D+/g, "") } },
          ],
        }
      : {}),
  };

  const where: Prisma.PessoaWhereInput = { documentos: { some: filtroDocumento } };

  const [pessoas, total, semPessoa, equipes, gerencias] = await Promise.all([
    prisma.pessoa.findMany({
      where,
      select: {
        id: true,
        nome: true,
        documentos: {
          select: {
            id: true,
            cpfCnpj: true,
            categoriaAtual: true,
            situacao: true,
            dataEntradaWr: true,
            equipe: { select: { nome: true } },
            gerencia: { select: { nome: true } },
            _count: { select: { cotasEfetivas: true } },
          },
        },
      },
      orderBy: { nome: "asc" },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.pessoa.count({ where }),
    // Nenhum cadastro pode desaparecer da lista por falta de pessoa.
    prisma.vendedor.count({ where: { pessoaId: null } }),
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

  // O consolidado vem só das pessoas desta página: a agregação é em SQL e não
  // faz sentido varrer a base inteira para preencher 50 linhas.
  const consolidados = await avaliarPessoas({
    pessoaIds: pessoas.map((pessoa) => pessoa.id),
    limite: POR_PAGINA,
  });
  const porPessoa = new Map(consolidados.map((item) => [item.pessoaId, item]));

  const linhas = pessoas.map((pessoa) => {
    // O documento com mais vendas responde pela pessoa nas colunas de resumo.
    const documentos = [...pessoa.documentos].sort(
      (a, b) => b._count.cotasEfetivas - a._count.cotasEfetivas,
    );
    const principal = documentos[0];

    const entradas = documentos
      .map((documento) => documento.dataEntradaWr)
      .filter((data): data is Date => data !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      id: pessoa.id,
      nome: pessoa.nome,
      href: `/vendedores/${principal?.id ?? ""}`,
      documentos,
      // A categoria da pessoa é a MAIS ALTA entre os documentos, não a do
      // documento com mais vendas. Quem tem o CPF antigo cheio de vendas como
      // iniciante e um CNPJ novo como veterano já é veterano — usar o documento
      // mais movimentado o mostraria como iniciante para sempre.
      categoriaAtual:
        categoriaDaPessoa(documentos.map((item) => item.categoriaAtual)) ?? "INICIANTE",
      consolidado: porPessoa.get(pessoa.id) ?? null,
      equipeNome: documentos.find((item) => item.equipe)?.equipe?.nome ?? null,
      gerenciaNome: documentos.find((item) => item.gerencia)?.gerencia?.nome ?? null,
      entradaWr: entradas[0] ?? null,
      cotas: documentos.reduce((soma, item) => soma + item._count.cotasEfetivas, 0),
      // Ativo em qualquer documento é ativo: desligado é quem não opera por nenhum.
      situacao: documentos.some((item) => item.situacao === "ATIVO")
        ? "ATIVO"
        : (principal?.situacao ?? "ATIVO"),
    };
  });

  const podeCriar = podeAcessar(sessao.perfil, "vendedores", "criar");

  return (
    <>
      <CabecalhoPagina
        titulo="Vendedores"
        descricao="Uma linha por pessoa, somando os documentos dela. A categoria vigente na data de cada venda é o que define o cálculo — mudanças não afetam vendas passadas."
      />

      {semPessoa > 0 ? (
        <Aviso tom="atencao">
          {formatarNumero(semPessoa)} cadastro(s) ainda não pertencem a nenhuma pessoa e por isso
          não aparecem aqui. Abra <strong>Vínculos de vendedores</strong> para resolver.
        </Aviso>
      ) : null}

      {podeCriar ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Novo vendedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NovoVendedor equipes={equipes} gerencias={gerencias} />
          </CardContent>
        </Card>
      ) : null}

      <form
        action="/vendedores"
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
      >
        <Campo rotulo="Busca" className="min-w-56 flex-1">
          <Entrada name="q" defaultValue={busca ?? ""} placeholder="Nome ou CPF/CNPJ" />
        </Campo>
        <Campo rotulo="Categoria" className="w-44">
          <Selecao name="categoria" defaultValue={categoria ?? ""}>
            <option value="">Todas</option>
            <option value="INICIANTE">Iniciante</option>
            <option value="VETERANO">Veterano</option>
            <option value="EXPERT">Expert</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Situação" className="w-44">
          <Selecao name="situacao" defaultValue={situacao ?? ""}>
            <option value="">Todas</option>
            <option value="ATIVO">Ativo</option>
            <option value="AFASTADO">Afastado</option>
            <option value="INATIVO">Inativo</option>
            <option value="DESLIGADO">Desligado</option>
          </Selecao>
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
                <Th>Vendedor</Th>
                <Th>CPF/CNPJ</Th>
                <Th>Categoria atual</Th>
                <Th className="text-right">Vendido (carteira)</Th>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Entrada WR</Th>
                <Th className="text-right">Cotas</Th>
                <Th>Situação</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {linhas.length === 0 ? (
                <TabelaVazia colunas={9} mensagem="Nenhum vendedor encontrado." />
              ) : (
                linhas.map((linha) => (
                  <Tr key={linha.id}>
                    <Td className="font-medium">
                      <Link
                        href={linha.href}
                        className="text-[var(--color-marca-forte)] hover:underline"
                      >
                        {linha.nome}
                      </Link>
                    </Td>
                    <Td className="numerico whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {linha.documentos.map((documento) => (
                          <span key={documento.id}>{formatarDocumento(documento.cpfCnpj)}</span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tom={TOM_CATEGORIA[linha.categoriaAtual]}>
                          {linha.categoriaAtual}
                        </Badge>
                        {linha.consolidado?.aptidao.apto ? (
                          <Badge tom="bom">
                            apto a {linha.consolidado.aptidao.categoriaAlvo}
                          </Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="numerico text-right whitespace-nowrap">
                      {linha.consolidado ? (
                        <>
                          <div>{formatarMoeda(linha.consolidado.volumeVendido)}</div>
                          {linha.consolidado.aptidao.volumeMinimo !== null &&
                          !linha.consolidado.aptidao.apto ? (
                            <div className="text-xs text-[var(--color-texto-3)]">
                              faltam {formatarMoeda(linha.consolidado.aptidao.faltam)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{linha.equipeNome ?? "—"}</Td>
                    <Td>{linha.gerenciaNome ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{formatarData(linha.entradaWr)}</Td>
                    <Td className="numerico text-right">{formatarNumero(linha.cotas)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tom={linha.situacao === "ATIVO" ? "bom" : "neutro"}>
                          {linha.situacao}
                        </Badge>
                        {linha.documentos.length > 1 ? (
                          <Badge tom="marca">{linha.documentos.length} documentos</Badge>
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
        base="/vendedores"
        parametros={brutos}
      />
    </>
  );
}

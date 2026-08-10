import Link from "next/link";
import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { type ParametrosBusca } from "@/lib/filtros";
import {
  Aviso,
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
import {
  estornosPorPessoa,
  totalizarEstornos,
} from "@/modules/apuracao/infrastructure/queries/estornos-por-pessoa";

export const metadata: Metadata = { title: "Estornos" };

/**
 * O que há a estornar de cada vendedor, separado por motivo.
 *
 * Os dois motivos ficam em colunas próprias porque são cobranças de naturezas
 * diferentes, com percentuais negociados separadamente. O vendedor que recebe
 * a conta pergunta primeiro de onde veio — e um total único obrigaria a abrir
 * venda por venda para responder.
 */
export default async function PaginaEstornos({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("comissoesEquipe");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, { de: new Date(0), ate: new Date() });

  const de = brutos.de ? parseDataBr(parametros.de) : undefined;
  const ate = brutos.ate ? parseDataBr(parametros.ate) : undefined;

  const [linhas, gerencias, equipes, pessoas, semRegra] = await Promise.all([
    estornosPorPessoa({
      de: de ?? undefined,
      ate: ate ?? undefined,
      pessoaId: parametros.pessoa,
      equipeId: escopo.equipeId ?? parametros.equipe,
      gerenciaId: escopo.gerenciaId ?? parametros.gerencia,
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
    prisma.pessoa.findMany({
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Venda cancelada que NÃO gerou estorno. Pode ser correto — a regra pode
    // dizer que não estorna — mas também é como uma regra faltando se
    // apresenta, e sem este número ninguém vai olhar.
    prisma.cota.count({
      where: { situacao: "CANCELADO", estorno: { is: null } },
    }),
  ]);

  const totais = totalizarEstornos(linhas);

  return (
    <>
      <CabecalhoPagina
        titulo="Estornos"
        descricao="Comissão a devolver por venda cancelada. Os dois motivos são cobranças distintas: recuperação e cancelamento com poucas parcelas pagas."
      />

      <FiltrosPeriodo
        acao="/estornos"
        parametros={parametros}
        opcoes={{
          ...(escopo.gerenciaId ? {} : { gerencias }),
          ...(escopo.equipeId ? {} : { equipes }),
          pessoas,
        }}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Total a estornar"
          valor={formatarMoeda(totais.total)}
          detalhe={`${formatarNumero(totais.vendas)} venda(s) de ${formatarNumero(totais.pessoas)} vendedor(es)`}
          tom={totais.total > 0 ? "atencao" : "neutro"}
        />
        <Indicador
          rotulo="Por recuperação"
          valor={formatarMoeda(totais.recuperacao)}
          detalhe="Vendas feitas durante período de recuperação"
        />
        <Indicador
          rotulo="Por cancelamento"
          valor={formatarMoeda(totais.cancelamento)}
          detalhe="Cancelamento com parcelas pagas abaixo do limite da regra"
        />
        <Indicador
          rotulo="Canceladas sem estorno"
          valor={formatarNumero(semRegra)}
          detalhe="Confira se falta regra cadastrada"
          tom={semRegra > 0 ? "atencao" : "neutro"}
        />
      </section>

      {totais.total === 0 && semRegra > 0 ? (
        <Aviso tom="atencao">
          Não há nenhum estorno apurado, mas existem {formatarNumero(semRegra)} venda(s)
          cancelada(s). Sem regra de estorno vigente para a categoria e a data do cancelamento,
          o sistema não cobra nada — e é assim de propósito, para nunca cobrar por suposição.
          Cadastre as regras em Administração → Regras e percentuais.
        </Aviso>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Vendedor</Th>
                <Th className="text-right">Recuperação</Th>
                <Th className="text-right">Cancelamento</Th>
                <Th className="text-right">Total a estornar</Th>
                <Th>Ver vendas</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {linhas.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhum estorno apurado no período." />
              ) : (
                linhas.map((linha) => (
                  <Tr key={linha.pessoaId ?? "sem-vendedor"}>
                    <Td>
                      {linha.pessoaNome}
                      {linha.pessoaId === null ? (
                        <Badge tom="atencao" className="ml-2">
                          sem vínculo
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="numerico text-right">
                      {linha.qtdRecuperacao > 0 ? (
                        <>
                          {formatarMoeda(linha.valorRecuperacao)}
                          <span className="block text-xs text-[var(--color-texto-3)]">
                            {formatarNumero(linha.qtdRecuperacao)} venda(s)
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="numerico text-right">
                      {linha.qtdCancelamento > 0 ? (
                        <>
                          {formatarMoeda(linha.valorCancelamento)}
                          <span className="block text-xs text-[var(--color-texto-3)]">
                            {formatarNumero(linha.qtdCancelamento)} venda(s)
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(linha.valorTotal)}
                    </Td>
                    <Td>
                      {linha.pessoaId ? (
                        <Link
                          href={`/clientes?pessoa=${linha.pessoaId}&estorno=QUALQUER`}
                          className="text-[var(--color-marca-forte)] hover:underline"
                        >
                          Abrir na carteira
                        </Link>
                      ) : (
                        <Link
                          href="/clientes?estorno=QUALQUER"
                          className="text-[var(--color-marca-forte)] hover:underline"
                        >
                          Abrir na carteira
                        </Link>
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

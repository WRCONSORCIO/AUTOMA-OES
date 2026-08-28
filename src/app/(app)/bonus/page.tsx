import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import { Gift, TriangleAlert } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { formatarMoeda, formatarNumero, formatarPercentual } from "@/lib/format";
import { periodoPadrao, type ParametrosBusca } from "@/lib/filtros";
import {
  Aviso,
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
import { FiltrosPeriodo, lerParametrosFiltro } from "@/components/filtros-periodo";
import { BotaoReapurarBonus } from "./formularios";

export const metadata: Metadata = { title: "Bônus de incentivo" };

interface LinhaRateio {
  gerenciaId: string | null;
  gerencia: string | null;
  cotas: bigint;
  valor: Prisma.Decimal | null;
}

/**
 * Rateio do bônus de incentivo por gerência.
 *
 * O bônus é da WR e não é repassado a ninguém — o que se quer saber é de onde
 * ele veio. Como o relatório da administradora não traz vendedor, a origem sai
 * da cota, que já carrega a gerência fixada na venda.
 */
export default async function PaginaBonus({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("comissoes");
  const escopo = escopoDoUsuario(sessao);
  const podeReapurar = podeAcessar(sessao.perfil, "comissoes", "editar");

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, periodoPadrao());
  const de = parseDataBr(parametros.de);
  const ate = parseDataBr(parametros.ate);

  const condicoes: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (de) condicoes.push(Prisma.sql`COALESCE(b."periodoFim", b."criadoEm") >= ${de}`);
  if (ate) condicoes.push(Prisma.sql`COALESCE(b."periodoInicio", b."criadoEm") <= ${ate}`);
  if (escopo.gerenciaId) condicoes.push(Prisma.sql`b."gerenciaId" = ${escopo.gerenciaId}`);
  if (escopo.equipeId) condicoes.push(Prisma.sql`b."equipeId" = ${escopo.equipeId}`);
  const onde = Prisma.join(condicoes, " AND ");

  const [rateio, gerencias] = await Promise.all([
    prisma.$queryRaw<LinhaRateio[]>`
      SELECT b."gerenciaId"            AS "gerenciaId",
             g."nome"                  AS gerencia,
             COUNT(*)                  AS cotas,
             SUM(b."valorIncentivo")   AS valor
        FROM "BonusIncentivo" b
        LEFT JOIN "Gerencia" g ON g."id" = b."gerenciaId"
       WHERE ${onde}
       GROUP BY 1, 2
       ORDER BY 4 DESC NULLS LAST
    `,
    prisma.gerencia.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const linhas = rateio.map((linha) => ({
    chave: linha.gerenciaId ?? "sem-gerencia",
    gerencia: linha.gerencia,
    cotas: Number(linha.cotas),
    valor: Math.round(Number(linha.valor ?? 0) * 100) / 100,
  }));

  const total = Math.round(linhas.reduce((soma, linha) => soma + linha.valor, 0) * 100) / 100;
  const totalCotas = linhas.reduce((soma, linha) => soma + linha.cotas, 0);
  const semGerencia = linhas.find((linha) => linha.gerencia === null);

  return (
    <>
      <CabecalhoPagina
        titulo="Bônus de incentivo"
        descricao="O que a administradora paga à WR por incentivo de vendas. Não é repassado a vendedor, equipe nem gerência — o rateio existe para saber de qual gerência veio cada real."
        acoes={podeReapurar ? <BotaoReapurarBonus /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Bônus no período"
          valor={formatarMoeda(total)}
          detalhe={`${formatarNumero(totalCotas)} cota(s)`}
          icone={<Gift className="h-4 w-4" />}
          tom="bom"
        />
        <Indicador
          rotulo="Atribuído a uma gerência"
          valor={formatarMoeda(total - (semGerencia?.valor ?? 0))}
          detalhe={
            total > 0
              ? `${formatarPercentual(((total - (semGerencia?.valor ?? 0)) / total) * 100)} do total`
              : undefined
          }
        />
        <Indicador
          rotulo="Sem gerência identificada"
          valor={formatarMoeda(semGerencia?.valor ?? 0)}
          detalhe={
            semGerencia ? `${formatarNumero(semGerencia.cotas)} cota(s) fora da base` : undefined
          }
          tom={semGerencia ? "atencao" : "neutro"}
          icone={semGerencia ? <TriangleAlert className="h-4 w-4" /> : undefined}
        />
      </div>

      <FiltrosPeriodo
        acao="/bonus"
        parametros={parametros}
        opcoes={escopo.gerenciaId ? {} : { gerencias }}
      />

      {semGerencia ? (
        <Aviso tom="atencao">
          {formatarNumero(semGerencia.cotas)} cota(s) de bônus ainda não têm gerência. O valor
          continua no total — ele é da WR de qualquer forma —, o que falta é saber de onde veio.
          A gerência do bônus é copiada da cota <strong>no momento em que o relatório é
          importado</strong>, e não volta a ser revista: se o relatório entrou antes da base, ou se
          o vendedor ganhou gerência depois, a atribuição ficou vazia e reimportar não resolve,
          porque a linha já está gravada. Clique em <strong>Reapurar bônus</strong> aqui em cima —
          ele procura a cota de novo e copia a gerência de hoje. Se depois disso o número não zerar,
          são cotas que o relatório traz e a base ainda não tem.
        </Aviso>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>De onde veio o bônus</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Gerência</Th>
                <Th className="text-right">Cotas</Th>
                <Th className="text-right">Bônus</Th>
                <Th className="text-right">Participação</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {linhas.length === 0 ? (
                <TabelaVazia
                  colunas={4}
                  mensagem="Nenhum bônus importado no período. Envie o relatório de incentivo em Importações."
                />
              ) : (
                linhas.map((linha) => (
                  <Tr key={linha.chave}>
                    <Td className="font-medium">
                      {linha.gerencia ?? (
                        <span className="text-[var(--color-atencao)]">
                          Sem gerência identificada
                        </span>
                      )}
                    </Td>
                    <Td className="numerico text-right">{formatarNumero(linha.cotas)}</Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(linha.valor)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarPercentual(total > 0 ? (linha.valor / total) * 100 : 0)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
            {linhas.length > 0 ? (
              <tfoot>
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  <Td className="numerico text-right font-semibold">
                    {formatarNumero(totalCotas)}
                  </Td>
                  <Td className="numerico text-right font-semibold">{formatarMoeda(total)}</Td>
                  <Td />
                </Tr>
              </tfoot>
            ) : null}
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

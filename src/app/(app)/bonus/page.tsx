import Link from "next/link";
import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import { Gift, TriangleAlert } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDocumento, parseDataBr } from "@/lib/normalize";
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

/** Uma linha do relatório de bônus, com a cota que respondeu por ela. */
interface LinhaDetalhe {
  id: string;
  grupo: string;
  cota: string;
  contrato: string;
  nomeConsorciado: string;
  parcela: number | null;
  valorEvento: Prisma.Decimal;
  valorIncentivo: Prisma.Decimal;
  cotaId: string | null;
  situacao: string | null;
  vendedorNome: string | null;
  vendedorDocumento: string | null;
  equipe: string | null;
}

/**
 * Teto de linhas do detalhe.
 *
 * A pergunta que o detalhe responde — "são estas cotas mesmo?" — se responde
 * olhando, e ninguém confere mil linhas na tela. O corte evita que uma
 * gerência grande trave a página, e o aviso diz que houve corte em vez de
 * deixar o usuário achar que viu tudo.
 */
const LIMITE_DO_DETALHE = 500;

/** Chave da linha "sem gerência" na URL — id nulo não vira parâmetro. */
const SEM_GERENCIA = "sem-gerencia";

/**
 * Preserva os filtros ao abrir ou fechar o detalhe.
 *
 * O usuário chegou àquela linha por um período e uma gerência escolhidos;
 * perder isso ao clicar faria o detalhe mostrar um recorte diferente do que
 * ele estava conferindo — que é o pior desfecho para uma tela cuja função é
 * confirmar um número.
 */
function comDetalhe(atuais: ParametrosBusca, chave: string | null): string {
  const parametros = new URLSearchParams();

  for (const [nome, valor] of Object.entries(atuais)) {
    if (nome === "detalhe" || typeof valor !== "string" || valor === "") continue;
    parametros.set(nome, valor);
  }

  if (chave) parametros.set("detalhe", chave);

  const consulta = parametros.toString();
  return consulta ? `/bonus?${consulta}` : "/bonus";
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

  // Qual gerência o usuário abriu. "sem-gerencia" é a linha sem atribuição,
  // que é justamente a que ele mais precisa conferir.
  const detalheDe = typeof brutos.detalhe === "string" ? brutos.detalhe : null;

  const [rateio, gerencias, detalhe] = await Promise.all([
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
    // O vendedor e o documento vêm junto de propósito: é por eles que se
    // reconhece a cota vendida no CNPJ da própria WR, que é o caso que motivou
    // este detalhe existir.
    detalheDe
      ? prisma.$queryRaw<LinhaDetalhe[]>`
          SELECT b."id",
                 b."grupo",
                 b."cota",
                 b."contrato",
                 b."nomeConsorciado",
                 b."parcela",
                 b."valorEvento",
                 b."valorIncentivo",
                 b."cotaId",
                 c."situacao"::text AS situacao,
                 v."nome"           AS "vendedorNome",
                 v."cpfCnpj"        AS "vendedorDocumento",
                 e."nome"           AS equipe
            FROM "BonusIncentivo" b
            LEFT JOIN "Cota"     c ON c."id" = b."cotaId"
            LEFT JOIN "Vendedor" v ON v."id" = c."vendedorEfetivoId"
            LEFT JOIN "Equipe"   e ON e."id" = b."equipeId"
           WHERE ${onde}
             AND ${
               detalheDe === SEM_GERENCIA
                 ? Prisma.sql`b."gerenciaId" IS NULL`
                 : Prisma.sql`b."gerenciaId" = ${detalheDe}`
             }
           ORDER BY b."valorIncentivo" DESC
           LIMIT ${LIMITE_DO_DETALHE}
        `
      : Promise.resolve([] as LinhaDetalhe[]),
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
                      <Link
                        href={comDetalhe(brutos, linha.chave)}
                        className="hover:underline"
                        aria-label={`Ver cotas de ${linha.gerencia ?? "sem gerência"}`}
                      >
                        {linha.gerencia ?? (
                          <span className="text-[var(--color-atencao)]">
                            Sem gerência identificada
                          </span>
                        )}
                      </Link>
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

      {detalheDe ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>
                Cotas do bônus —{" "}
                {detalheDe === SEM_GERENCIA
                  ? "sem gerência identificada"
                  : (gerencias.find((item) => item.id === detalheDe)?.nome ?? "gerência")}
              </CardTitle>
              <p className="mt-1 text-sm text-[var(--color-texto-2)]">
                {formatarNumero(detalhe.length)} linha(s) do relatório
                {detalhe.length >= LIMITE_DO_DETALHE
                  ? ` — mostrando as ${formatarNumero(LIMITE_DO_DETALHE)} de maior valor`
                  : ""}
                . O vendedor sai da cota vinculada; venda feita no CNPJ da própria WR aparece com
                o documento dela.
              </p>
            </div>
            <Link
              href={comDetalhe(brutos, null)}
              className="shrink-0 text-sm text-[var(--color-marca-forte)] hover:underline"
            >
              Fechar
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Tabela>
              <Cabecalho>
                <tr>
                  <Th>Grupo / cota</Th>
                  <Th>Contrato</Th>
                  <Th>Consorciado</Th>
                  <Th>Vendedor da cota</Th>
                  <Th className="text-right">Evento</Th>
                  <Th className="text-right">Bônus</Th>
                </tr>
              </Cabecalho>
              <tbody>
                {detalhe.length === 0 ? (
                  <TabelaVazia colunas={6} mensagem="Nenhuma linha de bônus nesta seleção." />
                ) : (
                  detalhe.map((linha) => (
                    <Tr key={linha.id}>
                      <Td className="numerico">
                        {linha.grupo} / {linha.cota}
                        {linha.parcela ? (
                          <span className="block text-xs text-[var(--color-texto-3)]">
                            parcela {formatarNumero(linha.parcela)}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="numerico">{linha.contrato}</Td>
                      <Td>
                        {linha.nomeConsorciado}
                        {linha.situacao ? (
                          <span className="block text-xs text-[var(--color-texto-3)]">
                            {linha.situacao.toLowerCase()}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        {linha.cotaId === null ? (
                          <span className="text-[var(--color-atencao)]">
                            cota não encontrada na base
                          </span>
                        ) : linha.vendedorNome ? (
                          <>
                            {linha.vendedorNome}
                            <span className="block text-xs text-[var(--color-texto-3)]">
                              {formatarDocumento(linha.vendedorDocumento)}
                              {linha.equipe ? ` · ${linha.equipe}` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--color-atencao)]">
                            cota sem vendedor identificado
                          </span>
                        )}
                      </Td>
                      <Td className="numerico text-right">
                        {formatarMoeda(Number(linha.valorEvento))}
                      </Td>
                      <Td className="numerico text-right font-medium">
                        {formatarMoeda(Number(linha.valorIncentivo))}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
              {detalhe.length > 0 ? (
                <tfoot>
                  <Tr>
                    <Td className="font-semibold" colSpan={5}>
                      Total das linhas mostradas
                    </Td>
                    <Td className="numerico text-right font-semibold">
                      {formatarMoeda(
                        detalhe.reduce((soma, linha) => soma + Number(linha.valorIncentivo), 0),
                      )}
                    </Td>
                  </Tr>
                </tfoot>
              ) : null}
            </Tabela>
          </CardContent>
        </Card>
      ) : null}

    </>
  );
}

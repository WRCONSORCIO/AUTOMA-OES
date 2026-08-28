import Link from "next/link";
import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
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
import {
  FiltrosPeriodo,
  lerParametrosFiltro,
} from "@/components/filtros-periodo";
import {
  estornosPorPessoa,
  totalizarEstornos,
} from "@/modules/apuracao/infrastructure/queries/estornos-por-pessoa";
import { estornosPrevistos } from "@/modules/apuracao/infrastructure/queries/estornos-previstos";
import { BotaoApurarEstornos } from "./formularios";

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
  const podeApurar = podeAcessar(sessao.perfil, "comissoesEquipe", "editar");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, {
    de: new Date(0),
    ate: new Date(),
  });

  const de = brutos.de ? parseDataBr(parametros.de) : undefined;
  const ate = brutos.ate ? parseDataBr(parametros.ate) : undefined;

  const [
    linhas,
    gerencias,
    equipes,
    pessoas,
    semRegra,
    semBase,
    coberturaCv069,
    aguardando,
    previsao,
  ] = await Promise.all([
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
    // Venda cancelada, com o débito JÁ lançado pela administradora, que mesmo
    // assim não gerou estorno. Pode ser correto — a regra pode dizer que não
    // estorna — mas também é como uma regra faltando se apresenta, e sem este
    // número ninguém vai olhar. As que ainda não têm débito lançado ficam de
    // fora de propósito: não são problema, são espera.
    prisma.cota.count({
      where: {
        situacao: "CANCELADO",
        estorno: { is: null },
        comissoes: { some: { tipo: "CANCELAMENTO_DE_PLANO" } },
      },
    }),
    // Estorno apurado cuja base é zero: a regra disse para cobrar, mas não há
    // registro de comissão paga sobre a venda. Para veterano e expert isso
    // quase sempre significa que o relatório de comissão paga direto ao
    // vendedor ainda não foi importado — sem ele não há de onde tirar o valor.
    prisma.estorno.count({
      where: { OR: [{ valorReferencia: 0 }, { valorReferencia: null }] },
    }),
    // Quanto do relatório de comissão paga direto ao vendedor já entrou.
    //
    // É a ÚNICA fonte da base do estorno em venda de veterano e expert, e sem
    // ela toda cobrança dessas categorias sai zerada. É o sintoma que mais
    // confunde: a regra está certa, a venda está certa, e o valor é zero. Sem
    // este número na tela, o usuário não tem como saber se o arquivo que ele
    // subiu cobre o mês inteiro ou só um pedaço.
    prisma.comissaoVendedorAdm.groupBy({
      by: ["vendedorDocumento"],
      _count: { _all: true },
    }),
    // Cancelada na base de clientes, sem o débito no relatório de comissão.
    // Não é erro nem cadastro faltando: a administradora ainda não devolveu a
    // cobrança à WR, e até lá não há perda para repassar ao vendedor. Aparece
    // na tela para que a espera seja visível — senão vira "sumiu um estorno".
    prisma.cota.count({
      where: {
        situacao: "CANCELADO",
        comissoes: { none: { tipo: "CANCELAMENTO_DE_PLANO" } },
      },
    }),
    // A previsão não é filtrada por data: ela responde "o que vem vindo", e
    // vir vindo não tem competência ainda. Filtrar por mês esconderia
    // justamente o que o mês seguinte vai trazer.
    estornosPrevistos({
      pessoaId: parametros.pessoa,
      equipeId: escopo.equipeId ?? parametros.equipe,
      gerenciaId: escopo.gerenciaId ?? parametros.gerencia,
    }),
  ]);

  const totais = totalizarEstornos(linhas);
  const linhasDoCv069 = coberturaCv069.reduce((soma, linha) => soma + linha._count._all, 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Estornos"
        descricao="Comissão a devolver por venda cancelada. O mês é o do CANCELAMENTO DE PLANO no relatório da administradora — o dia em que o dinheiro saiu da WR —, não o do cancelamento na base de clientes."
        acoes={podeApurar ? <BotaoApurarEstornos /> : undefined}
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
          rotulo="Previsto, ainda não cobrado"
          valor={formatarMoeda(previsao.total)}
          detalhe={`${formatarNumero(aguardando)} cancelada(s) aguardando o débito da administradora`}
          tom={previsao.total > 0 ? "atencao" : "neutro"}
        />
      </section>

      {semRegra > 0 ? (
        <Aviso tom="atencao">
          {formatarNumero(semRegra)} venda(s) já tiveram o{" "}
          <strong>CANCELAMENTO DE PLANO</strong> lançado pela administradora e
          mesmo assim não geraram estorno. Duas causas possíveis, e vale checar
          as duas: pode faltar regra vigente para a categoria da venda e a data
          do cancelamento — cadastre em{" "}
          <strong>Administração → Regras e percentuais</strong> — ou as regras
          podem ter sido cadastradas <strong>depois</strong> da importação, e aí
          ninguém reavaliou os cancelamentos que já estavam na base. Nesse caso
          é só clicar em <strong>Apurar estornos</strong> aqui em cima.
        </Aviso>
      ) : null}

      {semBase > 0 ? (
        <Aviso tom="atencao">
          {formatarNumero(semBase)} estorno(s) foram apurados com valor{" "}
          <strong>zero</strong>: a regra manda cobrar, mas não há comissão
          registrada sobre essas vendas para servir de base. O estorno é uma
          porcentagem do que o vendedor recebeu — sem saber quanto ele recebeu,
          não há o que devolver. Em venda de veterano ou expert, quem paga é a
          administradora, e a única fonte desse valor é o relatório de{" "}
          <strong>comissão paga direto ao vendedor</strong>.{" "}
          {coberturaCv069.length === 0 ? (
            <>
              Esse relatório <strong>ainda não foi importado</strong>: não há
              comissão da administradora registrada para nenhum vendedor.
              Enquanto ele não entrar, todo estorno de veterano e expert vai
              sair zerado.
            </>
          ) : (
            <>
              Hoje há comissão da administradora registrada para apenas{" "}
              <strong>
                {formatarNumero(coberturaCv069.length)} vendedor(es)
              </strong>
              , em {formatarNumero(linhasDoCv069)} linha(s). Se o fechamento do
              mês tem mais vendedores que isso, o arquivo importado está
              parcial — suba o relatório completo em Importações e apure de
              novo.
            </>
          )}
        </Aviso>
      ) : null}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            A cobrar — já debitado pela administradora
          </h2>
          <p className="text-sm text-[var(--color-texto-2)]">
            O dinheiro já saiu da WR. Estes valores podem entrar na folha do
            mês.
          </p>
        </div>

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
                  <TabelaVazia
                    colunas={5}
                    mensagem="Nenhum estorno apurado no período."
                  />
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
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            Previsão — ainda não cobrado
          </h2>
          <p className="text-sm text-[var(--color-texto-2)]">
            Vendas já canceladas na base de clientes cujo{" "}
            <strong>CANCELAMENTO DE PLANO</strong> ainda não apareceu no
            relatório da administradora. Não é cobrança: é o que vem vindo,
            calculado pelas mesmas regras. Serve para não pagar hoje o valor
            cheio de quem tem estorno a caminho.
          </p>
        </div>

        {previsao.semBase > 0 ? (
          <Aviso tom="atencao">
            {formatarNumero(previsao.semBase)} destas vendas ainda não têm
            comissão registrada para servir de base, então entram valendo zero.{" "}
            <strong>A previsão real é maior</strong> — importe o relatório de
            comissão paga direto ao vendedor para fechá-la.
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
                  <Th className="text-right">Previsto</Th>
                  <Th>Ver vendas</Th>
                </tr>
              </Cabecalho>
              <tbody>
                {previsao.linhas.length === 0 ? (
                  <TabelaVazia
                    colunas={5}
                    mensagem={
                      aguardando > 0
                        ? "Nenhuma das canceladas em espera gera estorno pelas regras de hoje."
                        : "Não há cancelamento aguardando o débito da administradora."
                    }
                  />
                ) : (
                  previsao.linhas.map((linha) => (
                    <Tr key={linha.pessoaId ?? "sem-vendedor-previsto"}>
                      <Td>
                        {linha.pessoaNome}
                        {linha.pessoaId === null ? (
                          <Badge tom="atencao" className="ml-2">
                            sem vínculo
                          </Badge>
                        ) : null}
                        {linha.semBase > 0 ? (
                          <span className="block text-xs text-[var(--color-texto-3)]">
                            {formatarNumero(linha.semBase)} sem base de comissão
                            conhecida
                          </span>
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
                          "\u2014"
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
                          "\u2014"
                        )}
                      </Td>
                      <Td className="numerico text-right font-medium">
                        {formatarMoeda(linha.valorTotal)}
                      </Td>
                      <Td>
                        <Link
                          href={
                            linha.pessoaId
                              ? `/clientes?pessoa=${linha.pessoaId}&situacao=CANCELADO`
                              : "/clientes?situacao=CANCELADO"
                          }
                          className="text-[var(--color-marca-forte)] hover:underline"
                        >
                          Abrir na carteira
                        </Link>
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Tabela>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

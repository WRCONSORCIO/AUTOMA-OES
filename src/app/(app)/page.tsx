import {
  Ban,
  BadgeDollarSign,
  CircleDollarSign,
  FileStack,
  LifeBuoy,
  Trophy,
  TrendingDown,
  Users,
} from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  carregarIndicadores,
  carregarRanking,
  carregarSerieMensal,
} from "@/server/services/dashboard";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { parseDataBr } from "@/lib/normalize";
import { periodoPadrao, type ParametrosBusca } from "@/lib/filtros";
import { Card, CardContent, CardHeader, CardTitle, CabecalhoPagina } from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { GraficoMensal, GraficoRanking } from "@/components/graficos";
import { FiltrosPeriodo, lerParametrosFiltro } from "@/components/filtros-periodo";
import { TabelaRanking } from "./tabela-ranking";

export default async function PaginaDashboard({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("dashboard");
  const escopo = escopoDoUsuario(sessao);

  const parametros = lerParametrosFiltro(await searchParams, periodoPadrao());

  const filtro = {
    de: parseDataBr(parametros.de) ?? undefined,
    ate: parseDataBr(parametros.ate) ?? undefined,
    administradoraId: parametros.administradora,
    gerenciaId: parametros.gerencia,
    equipeId: parametros.equipe,
    vendedorId: parametros.vendedor,
  };

  const [
    indicadores,
    serie,
    rankingVendedores,
    rankingEquipes,
    rankingGerencias,
    rankingAdministradoras,
    administradoras,
    gerencias,
    equipes,
  ] = await Promise.all([
    carregarIndicadores(filtro, escopo),
    carregarSerieMensal({ ...filtro, de: undefined, ate: undefined }, escopo),
    carregarRanking("vendedorId", filtro, escopo, 10),
    carregarRanking("equipeId", filtro, escopo, 10),
    carregarRanking("gerenciaId", filtro, escopo, 10),
    carregarRanking("administradoraId", filtro, escopo, 10),
    prisma.administradora.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    prisma.gerencia.findMany({
      where: { status: "ATIVO", ...(escopo.gerenciaId ? { id: escopo.gerenciaId } : {}) },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    prisma.equipe.findMany({
      where: {
        status: "ATIVO",
        ...(escopo.equipeId ? { id: escopo.equipeId } : {}),
        ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Dashboard"
        descricao="Acompanhamento financeiro e comercial da WR. Os valores são calculados automaticamente a partir das importações."
      />

      <FiltrosPeriodo
        acao="/"
        parametros={parametros}
        opcoes={{ administradoras, gerencias, equipes }}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Valor recebido"
          valor={formatarMoeda(indicadores.valorRecebido)}
          detalhe={`${formatarNumero(indicadores.lancamentos)} lançamento(s) no período`}
          icone={<CircleDollarSign className="h-4 w-4" />}
          tom="bom"
        />
        <Indicador
          rotulo="Comissão WR calculada"
          valor={formatarMoeda(indicadores.comissaoWr)}
          detalhe="Cruzamento da parcela com a tabela da categoria da venda"
          icone={<BadgeDollarSign className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Valor estornado"
          valor={formatarMoeda(indicadores.valorEstornado)}
          detalhe="Cancelamentos de plano no relatório"
          icone={<TrendingDown className="h-4 w-4" />}
          tom={indicadores.valorEstornado < 0 ? "critico" : "neutro"}
        />
        <Indicador
          rotulo="Parcelas processadas"
          valor={formatarNumero(indicadores.quantidadeParcelas)}
          detalhe="Total de lançamentos importados no período"
          icone={<FileStack className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Clientes ativos"
          valor={formatarNumero(indicadores.cotasAtivas)}
          detalhe={`${formatarNumero(indicadores.cotasTotal)} cota(s) na base`}
          icone={<Users className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Clientes cancelados"
          valor={formatarNumero(indicadores.cotasCanceladas)}
          icone={<Ban className="h-4 w-4" />}
          tom={indicadores.cotasCanceladas > 0 ? "atencao" : "neutro"}
        />
        <Indicador
          rotulo="Vendas em recuperação"
          valor={formatarNumero(indicadores.vendasEmRecuperacao)}
          detalhe={`${formatarNumero(indicadores.estornos)} com estorno gerado`}
          icone={<LifeBuoy className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Crédito total"
          valor={formatarMoeda(indicadores.creditoTotal)}
          detalhe="Somatório do crédito das cotas no período"
          icone={<Trophy className="h-4 w-4" />}
        />
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Valor recebido por mês</CardTitle>
            <p className="mt-1 text-sm text-[var(--color-texto-2)]">
              Série completa do histórico importado, independente do período filtrado.
            </p>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <GraficoMensal dados={serie} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ranking de vendedores</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <GraficoRanking dados={rankingVendedores} />
            <TabelaRanking dados={rankingVendedores} rotuloDimensao="Vendedor" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ranking de equipes</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <GraficoRanking dados={rankingEquipes} />
            <TabelaRanking dados={rankingEquipes} rotuloDimensao="Equipe" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ranking de gerências</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <GraficoRanking dados={rankingGerencias} />
            <TabelaRanking dados={rankingGerencias} rotuloDimensao="Gerência" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recebido por administradora</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <GraficoRanking dados={rankingAdministradoras} />
            <TabelaRanking dados={rankingAdministradoras} rotuloDimensao="Administradora" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

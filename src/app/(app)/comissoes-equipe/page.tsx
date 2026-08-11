import Link from "next/link";
import type { Metadata } from "next";
import { HandCoins, Hourglass, Wallet } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { formatarMoeda, formatarNumero, formatarPercentual,
  formatarData,
} from "@/lib/format";
import { montarQuery, periodoPadrao, texto, type ParametrosBusca } from "@/lib/filtros";
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
  Selecao,
  Tabela,
  TabelaVazia,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { FiltrosPeriodo, lerParametrosFiltro } from "@/components/filtros-periodo";
import {
  carregarPainelComissaoEquipe,
  lacunasDeTabela,
} from "@/server/services/comissao-equipe";
import { carregarTabelasInternas } from "@/server/services/tabelas-internas";
import { aPagarDoMes } from "@/modules/apuracao/infrastructure/queries/a-pagar-do-mes";
import { ROTULO_DESTINO, ROTULO_SEGMENTO } from "@/server/domain/tabelas-internas";
import { BotaoApurar } from "./apurar";

export const metadata: Metadata = { title: "Comissões da equipe" };

const ROTULO_PAPEL = {
  VENDEDOR: "Vendedor",
  SUPERVISOR: "Supervisão",
  GERENCIA: "Gerência",
} as const;

const TOM_PAPEL = {
  VENDEDOR: "marca",
  SUPERVISOR: "bom",
  GERENCIA: "atencao",
} as const;

export default async function PaginaComissoesEquipe({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("comissoesEquipe");
  const escopo = escopoDoUsuario(sessao);

  const brutos = await searchParams;
  const parametros = lerParametrosFiltro(brutos, periodoPadrao());
  const papel = texto(brutos, "papel");
  const categoria = texto(brutos, "categoria");

  const [painel, aPagar, tabelas, lacunas, tabelasAdministradora, gerencias, equipes] =
    await Promise.all([
    carregarPainelComissaoEquipe(
      {
        de: parseDataBr(parametros.de) ?? undefined,
        ate: parseDataBr(parametros.ate) ?? undefined,
        papel: papel ? (papel as "VENDEDOR") : undefined,
        categoria: categoria ? (categoria as "INICIANTE") : undefined,
        gerenciaId: parametros.gerencia,
        equipeId: parametros.equipe,
      },
      escopo,
    ),
    // O que a WR deve pagar sobre o que a administradora pagou no período.
    // É este o número da folha: se o cliente não paga a parcela, ela não
    // aparece no relatório e o vendedor não recebe por ela.
    aPagarDoMes({
      de: parseDataBr(parametros.de) ?? new Date(0),
      ate: parseDataBr(parametros.ate) ?? new Date(),
      gerenciaId: escopo.gerenciaId ?? parametros.gerencia,
      equipeId: escopo.equipeId ?? parametros.equipe,
      papel: papel ? (papel as "VENDEDOR") : undefined,
      detalharChave: brutos.beneficiario ? String(brutos.beneficiario) : undefined,
    }),
    carregarTabelasInternas(),
    lacunasDeTabela(),
    // Quantas tabelas do OUTRO tipo existem. Sem este número, quem cadastrou a
    // tabela errada lê "nenhuma tabela cadastrada" e conclui que o sistema
    // perdeu o que ele acabou de salvar.
    prisma.tabelaComissao.count({ where: { ativo: true } }),
    prisma.gerencia.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    prisma.equipe.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    ]);

  const podeApurar = podeAcessar(sessao.perfil, "comissoesEquipe", "editar");

  return (
    <>
      <CabecalhoPagina
        titulo="Comissões da equipe"
        descricao="O que a WR deve a vendedores, supervisão e gerência sobre cada venda. O previsto sai da tabela da categoria da venda; o liberado é a parte já coberta pelas parcelas recebidas da administradora."
        acoes={podeApurar ? <BotaoApurar /> : undefined}
      />

      {lacunas.length === 0 && tabelas.length === 0 ? (
        <Aviso tom="atencao">
          Nenhum percentual cadastrado e nenhuma venda com categoria resolvida. Comece pelas
          categorias em <strong>Comercial → Pendências de cadastro</strong>; o que faltar de
          percentual aparece aqui depois.
        </Aviso>
      ) : null}

      {lacunas.length > 0 ? (
        <Aviso tom="atencao">
          <p>
            Estas vendas têm categoria resolvida e continuam sem comissão porque{" "}
            <strong>não há percentual cadastrado</strong> para a combinação, ou porque a vigência
            do que existe começa depois da venda. O sistema não arbitra percentual: sem tabela,
            não calcula.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {lacunas.map((lacuna) => (
              <li key={`${lacuna.destino}-${lacuna.segmento ?? "geral"}-${lacuna.ano}`}>
                <strong>{ROTULO_DESTINO[lacuna.destino]}</strong>
                {lacuna.segmento
                  ? ` · ${ROTULO_SEGMENTO[lacuna.segmento]}`
                  : " · sem produto identificado"}{" "}
                · {lacuna.ano} — {formatarNumero(lacuna.vendas)} venda(s),{" "}
                {formatarMoeda(lacuna.credito)} de crédito
                {lacuna.motivo === "VIGENCIA" && lacuna.vigenteDe ? (
                  <span className="block text-xs">
                    Os percentuais existem, mas valem só a partir de{" "}
                    {formatarData(lacuna.vigenteDe)} — corrija a data de vigência.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Ajuste em <strong>Administração → Regras e percentuais</strong>, aba{" "}
            <strong>Comissões</strong>. A vigência precisa começar em data igual ou anterior à
            venda mais antiga — percentual cadastrado hoje não alcança venda de ontem.
          </p>
        </Aviso>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="A pagar no período"
          valor={formatarMoeda(aPagar.total)}
          detalhe={`${formatarNumero(aPagar.parcelas)} parcela(s) recebidas da administradora`}
          tom={aPagar.total > 0 ? "bom" : "neutro"}
          icone={<Wallet className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Vendedores"
          valor={formatarMoeda(
            aPagar.linhas
              .filter((linha) => linha.papel === "VENDEDOR")
              .reduce((soma, linha) => soma + linha.valor, 0),
          )}
          detalhe={`Supervisão ${formatarMoeda(
            aPagar.linhas
              .filter((linha) => linha.papel === "SUPERVISOR")
              .reduce((soma, linha) => soma + linha.valor, 0),
          )} · Gerência ${formatarMoeda(
            aPagar.linhas
              .filter((linha) => linha.papel === "GERENCIA")
              .reduce((soma, linha) => soma + linha.valor, 0),
          )}`}
          icone={<HandCoins className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Parcelas que não pagam"
          valor={formatarNumero(
            aPagar.semPagamento.parcelaNaoRemunerada +
              aPagar.semPagamento.categoriaNaoPaga +
              aPagar.semPagamento.semCota,
          )}
          detalhe={
            `${formatarNumero(aPagar.semPagamento.parcelaNaoRemunerada)} em parcela que a tabela do vendedor não paga · ` +
            `${formatarNumero(aPagar.semPagamento.categoriaNaoPaga)} de veterano/expert · ` +
            `${formatarNumero(aPagar.semPagamento.semCota)} sem vendedor ou categoria`
          }
          tom={aPagar.semPagamento.semCota > 0 ? "atencao" : "neutro"}
        />
      </div>

      <FiltrosPeriodo
        acao="/comissoes-equipe"
        parametros={parametros}
        opcoes={{
          ...(escopo.gerenciaId ? {} : { gerencias }),
          ...(escopo.equipeId ? {} : { equipes }),
        }}
      />

      <form
        action="/comissoes-equipe"
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
      >
        <input type="hidden" name="de" value={parametros.de} />
        <input type="hidden" name="ate" value={parametros.ate} />
        {parametros.gerencia ? (
          <input type="hidden" name="gerencia" value={parametros.gerencia} />
        ) : null}
        {parametros.equipe ? (
          <input type="hidden" name="equipe" value={parametros.equipe} />
        ) : null}

        <Campo rotulo="Papel" className="w-44">
          <Selecao name="papel" defaultValue={papel ?? ""}>
            <option value="">Todos</option>
            <option value="VENDEDOR">Vendedor</option>
            <option value="SUPERVISOR">Supervisão</option>
            <option value="GERENCIA">Gerência</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Categoria da venda" className="w-44">
          <Selecao name="categoria" defaultValue={categoria ?? ""}>
            <option value="">Todas</option>
            <option value="INICIANTE">Iniciante</option>
            <option value="VETERANO">Veterano</option>
            <option value="EXPERT">Expert</option>
          </Selecao>
        </Campo>
        <button
          type="submit"
          className="h-10 rounded-lg bg-[var(--color-marca)] px-4 text-sm font-medium text-white hover:bg-[var(--color-marca-forte)] dark:text-[#0b0b0b]"
        >
          Aplicar
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>A pagar por beneficiário</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            O período filtra pela <strong>data do relatório da administradora</strong>: só entra
            aqui a parcela que a WR recebeu. Se o cliente não paga, o vendedor não recebe — e a
            parcela que a tabela não remunera também não aparece.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Beneficiário</Th>
                <Th>Papel</Th>
                <Th className="text-right">Parcelas</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Base</Th>
                <Th className="text-right">A pagar</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {aPagar.linhas.length === 0 ? (
                <TabelaVazia
                  colunas={6}
                  mensagem="Nenhuma parcela recebida da administradora no período. Importe o relatório de comissão em Importações, ou amplie o período."
                />
              ) : (
                aPagar.linhas.map((linha) => (
                  <Tr key={linha.chave}>
                    <Td className="font-medium">
                      <Link
                        href={`/comissoes-equipe${montarQuery(brutos, {
                          beneficiario:
                            brutos.beneficiario === linha.chave ? undefined : linha.chave,
                        })}`}
                        className="text-[var(--color-marca-forte)] hover:underline"
                      >
                        {linha.beneficiario}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tom={TOM_PAPEL[linha.papel]}>{ROTULO_PAPEL[linha.papel]}</Badge>
                    </Td>
                    <Td className="numerico text-right">{formatarNumero(linha.parcelas)}</Td>
                    <Td className="numerico text-right">{formatarNumero(linha.vendas)}</Td>
                    <Td className="numerico text-right">{formatarMoeda(linha.base)}</Td>
                    <Td className="numerico text-right font-medium text-[var(--color-bom)]">
                      {formatarMoeda(linha.valor)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      {aPagar.detalheDe ? (
        <Card>
          <CardHeader>
            <CardTitle>Clientes que estão pagando {aPagar.detalheDe}</CardTitle>
            <p className="text-sm text-[var(--color-texto-2)]">
              Uma linha por parcela recebida no período. É a conferência do valor: quem paga a
              comissão é o cliente, e aqui está cada um deles com a parcela que entrou.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Tabela>
              <Cabecalho>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Contrato</Th>
                  <Th>Grupo / Cota</Th>
                  <Th className="text-right">Parcela</Th>
                  <Th className="text-right">Crédito</Th>
                  <Th className="text-right">Base</Th>
                  <Th className="text-right">%</Th>
                  <Th className="text-right">A pagar</Th>
                </tr>
              </Cabecalho>
              <tbody>
                {aPagar.detalhe.length === 0 ? (
                  <TabelaVazia colunas={8} mensagem="Nenhuma parcela no período." />
                ) : (
                  aPagar.detalhe.map((item, indice) => (
                    <Tr key={`${item.cotaId ?? item.contrato}-${item.parcela}-${indice}`}>
                      <Td className="font-medium">
                        {item.cotaId ? (
                          <Link
                            href={`/clientes/${item.cotaId}`}
                            className="text-[var(--color-marca-forte)] hover:underline"
                          >
                            {item.cliente}
                          </Link>
                        ) : (
                          item.cliente
                        )}
                      </Td>
                      <Td className="numerico">{item.contrato}</Td>
                      <Td className="numerico whitespace-nowrap">
                        {item.grupo} / {item.cota}
                      </Td>
                      <Td className="numerico text-right">{item.parcela}</Td>
                      <Td className="numerico text-right">{formatarMoeda(item.credito)}</Td>
                      <Td className="numerico text-right">{formatarMoeda(item.base)}</Td>
                      <Td className="numerico text-right">
                        {formatarPercentual(item.percentual)}
                      </Td>
                      <Td className="numerico text-right font-medium text-[var(--color-bom)]">
                        {formatarMoeda(item.valor)}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Tabela>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
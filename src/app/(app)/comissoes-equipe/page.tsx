import type { Metadata } from "next";
import { HandCoins, Hourglass, Wallet } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseDataBr } from "@/lib/normalize";
import { formatarMoeda, formatarNumero, formatarPercentual,
  formatarData,
} from "@/lib/format";
import { periodoPadrao, texto, type ParametrosBusca } from "@/lib/filtros";
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

  const [painel, tabelas, lacunas, tabelasAdministradora, gerencias, equipes] =
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Previsto"
          valor={formatarMoeda(painel.totais.previsto)}
          detalhe={`${formatarNumero(painel.totais.vendas)} apuração(ões) de venda`}
          icone={<HandCoins className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Liberado"
          valor={formatarMoeda(painel.totais.liberado)}
          detalhe="Coberto pelas parcelas já recebidas"
          tom="bom"
          icone={<Wallet className="h-4 w-4" />}
        />
        <Indicador
          rotulo="A liberar"
          valor={formatarMoeda(painel.totais.aLiberar)}
          detalhe="Aguardando o recebimento da administradora"
          tom="atencao"
          icone={<Hourglass className="h-4 w-4" />}
        />
        <Indicador
          rotulo="Vendedores"
          valor={formatarMoeda(painel.porPapel.VENDEDOR.previsto)}
          detalhe={`Supervisão ${formatarMoeda(painel.porPapel.SUPERVISOR.previsto)} · Gerência ${formatarMoeda(painel.porPapel.GERENCIA.previsto)}`}
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
          <CardTitle>Por beneficiário</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            O período filtra pela data da venda — é a venda que gera a comissão, não o mês em que
            a parcela foi paga.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Beneficiário</Th>
                <Th>Papel</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Base</Th>
                <Th className="text-right">Previsto</Th>
                <Th className="text-right">Liberado</Th>
                <Th className="text-right">A liberar</Th>
                <Th className="text-right">% liberado</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {painel.linhas.length === 0 ? (
                <TabelaVazia
                  colunas={8}
                  mensagem="Nenhuma comissão apurada no período. Verifique se há tabela vigente para a categoria das vendas."
                />
              ) : (
                painel.linhas.map((linha) => (
                  <Tr key={`${linha.papel}-${linha.chave}`}>
                    <Td className="font-medium">{linha.beneficiario}</Td>
                    <Td>
                      <Badge tom={TOM_PAPEL[linha.papel]}>{ROTULO_PAPEL[linha.papel]}</Badge>
                    </Td>
                    <Td className="numerico text-right">{formatarNumero(linha.vendas)}</Td>
                    <Td className="numerico text-right">{formatarMoeda(linha.base)}</Td>
                    <Td className="numerico text-right font-medium">
                      {formatarMoeda(linha.previsto)}
                    </Td>
                    <Td className="numerico text-right text-[var(--color-bom)]">
                      {formatarMoeda(linha.liberado)}
                    </Td>
                    <Td className="numerico text-right text-[var(--color-atencao)]">
                      {formatarMoeda(linha.aLiberar)}
                    </Td>
                    <Td className="numerico text-right">
                      {formatarPercentual(
                        linha.previsto > 0 ? (linha.liberado / linha.previsto) * 100 : 0,
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

import type { Metadata } from "next";
import type { DestinoComissao, SegmentoVenda } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarPercentual } from "@/lib/format";
import type { ParametrosBusca } from "@/lib/filtros";
import {
  Aviso,
  Badge,
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
import { Abas, lerAba, type Aba } from "@/components/abas";
import {
  DESTINO_PAGO,
  ROTULO_DESTINO,
  ROTULO_SEGMENTO,
} from "@/server/domain/tabelas-internas";
import { carregarTabelasInternas } from "@/server/services/tabelas-internas";
import { BotaoAjustarVigencia, BotaoSemear, EditorTabela } from "./formularios";
import { BotaoAlternarFlex, FormularioFlex } from "../tabelas/formularios";
import { listarRegrasEstorno } from "@/modules/apuracao/application/use-cases/configurar-regra-estorno";
import {
  BotaoAjustarVigenciaDasRegras,
  LinhaRegraEstorno,
  NovaRegraEstorno,
} from "./estorno-formularios";
import { listarMetas } from "@/modules/comercial/application/use-cases/configurar-metas";
import { LinhaMeta, NovaMeta } from "./metas-formularios";

export const metadata: Metadata = { title: "Configurações" };

const ABAS: Aba[] = [
  { chave: "comissoes", rotulo: "Comissões" },
  { chave: "flex", rotulo: "Flex" },
  { chave: "estornos", rotulo: "Estornos" },
  { chave: "metas", rotulo: "Metas de promoção" },
];

/** A ordem em que as tabelas aparecem: quem a WR paga primeiro. */
const ORDEM_DESTINO: DestinoComissao[] = [
  "INICIANTE",
  "SUPERVISOR",
  "GERENCIA",
  "VETERANO",
  "EXPERT",
];

const ORDEM_SEGMENTO: SegmentoVenda[] = ["IMOVEL", "AUTOMOVEL"];

export default async function PaginaConfiguracoes({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusca>;
}) {
  const sessao = await exigirPermissao("tabelas");
  const podeEditar = podeAcessar(sessao.perfil, "tabelas", "editar");

  const brutos = await searchParams;
  const aba = lerAba(brutos, ABAS);

  const [tabelas, modalidades, regrasEstorno, metas, vendedores, primeiraVenda] =
    await Promise.all([
    carregarTabelasInternas(),
    prisma.modalidadeFlex.findMany({ orderBy: { percentual: "asc" } }),
    listarRegrasEstorno(),
    listarMetas(),
    prisma.vendedor.findMany({
      where: { situacao: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // A venda mais antiga é a régua: percentual que começa depois dela deixa
    // parte da base sem cálculo.
    prisma.cota.aggregate({ _min: { dataVenda: true } }),
    ]);

  const vendaMaisAntiga = primeiraVenda._min.dataVenda;

  const dia = (data: Date | null) => (data ? data.toISOString().slice(0, 10) : null);
  const metasView = metas.map((meta) => ({
    ...meta,
    vigenteDe: dia(meta.vigenteDe) as string,
    vigenteAte: dia(meta.vigenteAte),
  }));

  const regrasView = regrasEstorno.map((regra) => ({
    ...regra,
    categoriasVenda: regra.categoriasVenda as string[],
    vigenteDe: dia(regra.vigenteDe) as string,
    vigenteAte: dia(regra.vigenteAte),
  }));

  const porChave = new Map(
    tabelas.map((tabela) => [`${tabela.destino}|${tabela.segmento}`, tabela]),
  );

  const quadros = ORDEM_DESTINO.flatMap((destino) =>
    ORDEM_SEGMENTO.map((segmento) => {
      const tabela = porChave.get(`${destino}|${segmento}`);
      return {
        destino,
        segmento,
        destinoRotulo: ROTULO_DESTINO[destino],
        segmentoRotulo: ROTULO_SEGMENTO[segmento],
        pago: DESTINO_PAGO[destino],
        faixas: (tabela?.faixas ?? []).map((faixa) => ({
          parcela: faixa.parcela,
          percentual: String(faixa.percentual).replace(".", ","),
        })),
        vigenteDe: tabela ? formatarData(tabela.vigenteDe) : null,
        // Vigência que começa depois da venda mais antiga não alcança tudo o
        // que já foi importado — é o que faz percentual certo calcular zero.
        atrasada:
          tabela !== undefined &&
          vendaMaisAntiga !== null &&
          tabela.vigenteDe.getTime() > vendaMaisAntiga.getTime(),
      };
    }),
  );

  const semNenhuma = tabelas.length === 0;
  const algumaAtrasada = quadros.some((quadro) => quadro.atrasada);

  // Regra cujo período aberto começa depois da venda mais antiga: ela não
  // alcança os cancelamentos que já estão na base, e a apuração vai responder
  // "sem regra vigente" para eles sem que nada na tela explique por quê.
  const algumaRegraAtrasada =
    vendaMaisAntiga !== null &&
    regrasEstorno.some(
      (regra) => regra.vigenteAte === null && new Date(regra.vigenteDe) > vendaMaisAntiga,
    );

  return (
    <>
      <CabecalhoPagina
        titulo="Configurações"
        descricao="Percentuais e regras do sistema. Tudo aqui é editável — nenhum valor vive no código."
      />

      <Abas abas={ABAS} ativa={aba} base="/configuracoes" parametros={brutos} />

      {aba === "comissoes" ? (
        <>
          <Aviso tom="marca">
            <strong>Iniciante, supervisão e gerência</strong> são o que a WR paga.{" "}
            <strong>Veterano e expert</strong> recebem direto da administradora — a WR não paga
            nada por essas vendas, e as tabelas existem para calcular o estorno quando a venda cai.
            Parcela deixada em branco não paga.
          </Aviso>

          {semNenhuma ? (
            <Aviso tom="atencao">
              Nenhuma tabela cadastrada ainda. Use o botão abaixo para criar as cinco com os
              percentuais iniciais — depois é só ajustar o que precisar.
            </Aviso>
          ) : null}

          {podeEditar ? (
            <Card>
              <CardContent className="flex flex-col gap-4 py-4">
                <BotaoSemear />
                {algumaAtrasada ? <BotaoAjustarVigencia /> : null}
              </CardContent>
            </Card>
          ) : null}

          {algumaAtrasada ? (
            <Aviso tom="critico">
              Há percentuais cadastrados cuja vigência começa <strong>depois</strong> de vendas
              que já estão na base. Eles estão corretos, mas não alcançam essas vendas — e o
              resultado é comissão zero sem nenhum erro aparente. Use{" "}
              <strong>“Aplicar às vendas já importadas”</strong> acima; nenhum percentual é
              alterado, só a data a partir da qual eles contam.
            </Aviso>
          ) : null}

          {podeEditar ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {quadros.map((quadro) => (
                <EditorTabela
                  key={`${quadro.destino}-${quadro.segmento}`}
                  tabela={quadro}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Tabela>
                  <Cabecalho>
                    <tr>
                      <Th>Tabela</Th>
                      <Th>Produto</Th>
                      <Th>Percentuais por parcela</Th>
                    </tr>
                  </Cabecalho>
                  <tbody>
                    {quadros.length === 0 ? (
                      <TabelaVazia colunas={3} mensagem="Nenhuma tabela cadastrada." />
                    ) : (
                      quadros.map((quadro) => (
                        <Tr key={`${quadro.destino}-${quadro.segmento}`}>
                          <Td className="font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              {quadro.destinoRotulo}
                              <Badge tom={quadro.pago ? "bom" : "neutro"}>
                                {quadro.pago ? "A WR paga" : "Só estorno"}
                              </Badge>
                            </div>
                          </Td>
                          <Td>{quadro.segmentoRotulo}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1.5">
                              {quadro.faixas.length === 0 ? (
                                <span className="text-[var(--color-texto-3)]">—</span>
                              ) : (
                                quadro.faixas.map((faixa) => (
                                  <span
                                    key={faixa.parcela}
                                    className="numerico rounded-md border border-[var(--color-borda)] px-2 py-0.5 text-xs"
                                  >
                                    {faixa.parcela}ª: {faixa.percentual}%
                                  </span>
                                ))
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))
                    )}
                  </tbody>
                </Tabela>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}

      {aba === "flex" ? (
        <>
          <Aviso tom="marca">
            O flex reduz a base da comissão: crédito de R$ 500.000 com Flex 50 gera base de
            R$ 250.000. Todas as tabelas de comissão calculam sobre essa base.
          </Aviso>

          {podeEditar ? (
            <Card>
              <CardHeader>
                <CardTitle>Nova modalidade</CardTitle>
              </CardHeader>
              <CardContent>
                <FormularioFlex />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="p-0">
              <Tabela>
                <Cabecalho>
                  <tr>
                    <Th>Modalidade</Th>
                    <Th className="text-right">Percentual da base</Th>
                    <Th>Situação</Th>
                    {podeEditar ? <Th>Ações</Th> : null}
                  </tr>
                </Cabecalho>
                <tbody>
                  {modalidades.length === 0 ? (
                    <TabelaVazia
                      colunas={podeEditar ? 4 : 3}
                      mensagem="Nenhuma modalidade cadastrada."
                    />
                  ) : (
                    modalidades.map((modalidade) => (
                      <Tr key={modalidade.id}>
                        <Td className="font-medium">{modalidade.nome}</Td>
                        <Td className="numerico text-right">
                          {formatarPercentual(modalidade.percentual)}
                        </Td>
                        <Td>
                          <Badge tom={modalidade.ativo ? "bom" : "neutro"}>
                            {modalidade.ativo ? "Ativa" : "Inativa"}
                          </Badge>
                        </Td>
                        {podeEditar ? (
                          <Td>
                            <BotaoAlternarFlex id={modalidade.id} ativo={modalidade.ativo} />
                          </Td>
                        ) : null}
                      </Tr>
                    ))
                  )}
                </tbody>
              </Tabela>
            </CardContent>
          </Card>
        </>
      ) : null}

      {aba === "estornos" ? (
        <>
          <Aviso tom="marca">
            Só existem <strong>duas</strong> situações de estorno: venda feita em
            período de recuperação, e cancelamento com poucas parcelas pagas.
            Quais categorias de venda cada uma alcança é o que as caixas de
            seleção da regra definem. Fora dessas duas, nada é cobrado do
            vendedor.
          </Aviso>

          <Aviso tom="atencao">
            Alterar uma regra <strong>não reescreve o passado</strong>: o período
            atual é encerrado e um novo é aberto a partir da data informada. Um
            cancelamento é sempre julgado pela regra que valia no dia em que
            aconteceu.
          </Aviso>

          {algumaRegraAtrasada ? (
            <Aviso tom="atencao">
              Há regra cuja vigência começa <strong>depois</strong> de vendas que já estão na base.
              A regra é escolhida pela data do cancelamento, então nenhum cancelamento anterior a
              essa data encontra regra — e a apuração responde &quot;sem regra vigente&quot; sem
              cobrar ninguém. É o que acontece quando a regra é cadastrada depois da importação,
              que é a ordem natural das coisas.
              {podeEditar ? (
                <span className="mt-3 block">
                  <BotaoAjustarVigenciaDasRegras />
                </span>
              ) : null}
            </Aviso>
          ) : null}

          {podeEditar ? (
            <Card>
              <CardContent className="py-4">
                <NovaRegraEstorno vendedores={vendedores} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Regras cadastradas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {regrasView.length === 0 ? (
                <p className="text-sm text-[var(--color-texto-2)]">
                  Nenhuma regra cadastrada. Sem regra vigente, nenhum cancelamento
                  gera estorno.
                </p>
              ) : (
                regrasView.map((regra) => (
                  <LinhaRegraEstorno
                    key={regra.id}
                    regra={regra}
                    vendedores={vendedores}
                    podeEditar={podeEditar}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {aba === "metas" ? (
        <>
          <Aviso tom="marca">
            A pessoa progride ao atingir volume vendido, e cada degrau abre um CNPJ novo:
            o <strong>iniciante</strong> vira <strong>veterano</strong> e passa a operar pelo
            CNPJ; o veterano vira <strong>expert</strong>, que não vende — é a identidade pela
            qual ele recebe supervisão. O volume conta a <strong>carteira completa</strong>,
            somando todos os documentos da pessoa.
          </Aviso>

          <Aviso tom="atencao">
            O sistema <strong>não promove sozinho</strong>. A meta define quem aparece como apto;
            quem decide é o RH, na ficha da pessoa. Alterar uma meta não reclassifica ninguém que
            já foi promovido.
          </Aviso>

          {podeEditar ? (
            <Card>
              <CardContent className="py-4">
                <NovaMeta />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Metas cadastradas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {metasView.length === 0 ? (
                <p className="text-sm text-[var(--color-texto-2)]">
                  Nenhuma meta cadastrada. Sem meta vigente, ninguém aparece como apto para
                  promoção.
                </p>
              ) : (
                metasView.map((meta) => (
                  <LinhaMeta key={meta.id} meta={meta} podeEditar={podeEditar} />
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

import type { Metadata } from "next";
import type { DestinoComissao, SegmentoVenda } from "@prisma/client";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarPercentual } from "@/lib/format";
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
import { BotaoSemear, EditorTabela } from "./formularios";
import { BotaoAlternarFlex, FormularioFlex } from "../tabelas/formularios";

export const metadata: Metadata = { title: "Configurações" };

const ABAS: Aba[] = [
  { chave: "comissoes", rotulo: "Comissões" },
  { chave: "flex", rotulo: "Flex" },
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

  const [tabelas, modalidades] = await Promise.all([
    carregarTabelasInternas(),
    prisma.modalidadeFlex.findMany({ orderBy: { percentual: "asc" } }),
  ]);

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
      };
    }),
  );

  const semNenhuma = tabelas.length === 0;

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
              <CardContent className="py-4">
                <BotaoSemear />
              </CardContent>
            </Card>
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
    </>
  );
}

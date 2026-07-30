import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarPercentual } from "@/lib/format";
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
import {
  BotaoAlternarEquipe,
  BotaoAlternarFlex,
  FormularioFlex,
  FormularioTabela,
  FormularioTabelaEquipe,
} from "./formularios";

export const metadata: Metadata = { title: "Tabelas e Flex" };

const ROTULO_PAPEL = {
  VENDEDOR: "Vendedor",
  SUPERVISOR: "Supervisão",
  GERENCIA: "Gerência",
} as const;

const ROTULO_CONDICAO = {
  SEMPRE: "",
  SUPERVISAO_DIFERENTE_GERENCIA: " (supervisão ≠ gerente)",
  EQUIPE_HABILITADA: " (equipes marcadas)",
} as const;

export default async function PaginaTabelas() {
  const sessao = await exigirPermissao("tabelas");
  const podeEditar = podeAcessar(sessao.perfil, "tabelas", "editar");

  const [tabelas, tabelasEquipe, equipes, modalidades] = await Promise.all([
    prisma.tabelaComissao.findMany({
      include: { faixas: { orderBy: { parcela: "asc" } } },
      orderBy: [{ categoria: "asc" }, { vigenteDe: "desc" }],
    }),
    prisma.tabelaComissaoEquipe.findMany({
      include: { regras: { orderBy: { papel: "asc" } } },
      orderBy: [{ categoria: "asc" }, { vigenteDe: "desc" }],
    }),
    prisma.equipe.findMany({
      where: { status: "ATIVO" },
      select: {
        id: true,
        nome: true,
        habilitadaComissao: true,
        gerencia: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
    }),
    prisma.modalidadeFlex.findMany({ orderBy: { percentual: "desc" } }),
  ]);

  const semTabelaIniciante = !tabelas.some(
    (tabela) => tabela.categoria === "INICIANTE" && tabela.vigenteAte === null,
  );

  return (
    <>
      <CabecalhoPagina
        titulo="Tabelas de comissão e Flex"
        descricao="Percentuais por parcela e modalidades de flex. Alterar percentuais cria uma nova vigência — os cálculos já feitos permanecem com os valores da época."
      />

      {semTabelaIniciante ? (
        <Aviso tom="atencao">
          Não há tabela de Iniciante vigente. Sem ela, os lançamentos de vendas com categoria
          Iniciante não geram comissão WR.
        </Aviso>
      ) : null}

      {podeEditar ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Nova tabela de comissão</CardTitle>
              <p className="text-sm text-[var(--color-texto-2)]">
                Preencha o percentual de cada parcela. Parcelas sem percentual não geram comissão
                WR — é assim que a regra “acima da parcela 4 não gera comissão de Iniciante” é
                configurada.
              </p>
            </CardHeader>
            <CardContent>
              <FormularioTabela />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nova modalidade Flex</CardTitle>
              <p className="text-sm text-[var(--color-texto-2)]">
                A base da comissão é o crédito multiplicado pelo percentual da modalidade. Ex.:
                crédito de R$ 500.000 com Flex 50 gera base de R$ 250.000.
              </p>
            </CardHeader>
            <CardContent>
              <FormularioFlex />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tabelas de comissão</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Tabela</Th>
                <Th>Categoria</Th>
                <Th>Vigente de</Th>
                <Th>Vigente até</Th>
                <Th>Percentuais por parcela</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {tabelas.length === 0 ? (
                <TabelaVazia colunas={5} mensagem="Nenhuma tabela cadastrada." />
              ) : (
                tabelas.map((tabela) => (
                  <Tr key={tabela.id}>
                    <Td className="font-medium">{tabela.nome}</Td>
                    <Td>
                      <Badge tom="marca">{tabela.categoria}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatarData(tabela.vigenteDe)}</Td>
                    <Td className="whitespace-nowrap">
                      {tabela.vigenteAte ? (
                        formatarData(tabela.vigenteAte)
                      ) : (
                        <Badge tom="bom">Vigente</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {tabela.faixas.map((faixa) => (
                          <span
                            key={faixa.id}
                            className="numerico rounded-md border border-[var(--color-borda)] px-2 py-0.5 text-xs"
                          >
                            Parcela {faixa.parcela}: {formatarPercentual(faixa.percentual)}
                          </span>
                        ))}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      {podeEditar ? (
        <Card>
          <CardHeader>
            <CardTitle>Nova tabela de comissão da equipe</CardTitle>
            <p className="text-sm text-[var(--color-texto-2)]">
              Percentuais que a WR paga a vendedor, supervisão e gerência sobre cada venda. Assim
              que a tabela é criada, o sistema apura tudo o que já foi importado — o previsto e o
              liberado aparecem em <strong>Comissões da equipe</strong>.
            </p>
          </CardHeader>
          <CardContent>
            <FormularioTabelaEquipe />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tabelas de comissão da equipe</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Tabela</Th>
                <Th>Categoria</Th>
                <Th>Vigente de</Th>
                <Th>Vigente até</Th>
                <Th className="text-right">Libera em</Th>
                <Th>Percentuais por papel</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {tabelasEquipe.length === 0 ? (
                <TabelaVazia
                  colunas={6}
                  mensagem="Nenhuma tabela cadastrada. Sem ela o sistema não tem percentual para calcular a comissão da equipe."
                />
              ) : (
                tabelasEquipe.map((tabela) => (
                  <Tr key={tabela.id}>
                    <Td className="font-medium">{tabela.nome}</Td>
                    <Td>
                      <Badge tom="marca">{tabela.categoria}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatarData(tabela.vigenteDe)}</Td>
                    <Td className="whitespace-nowrap">
                      {tabela.vigenteAte ? (
                        formatarData(tabela.vigenteAte)
                      ) : (
                        <Badge tom="bom">Vigente</Badge>
                      )}
                    </Td>
                    <Td className="numerico text-right">
                      {tabela.parcelasParaLiberacao === 1
                        ? "1 parcela"
                        : `${tabela.parcelasParaLiberacao} parcelas`}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {tabela.regras.map((regra) => (
                          <span
                            key={regra.id}
                            className="numerico rounded-md border border-[var(--color-borda)] px-2 py-0.5 text-xs"
                          >
                            {ROTULO_PAPEL[regra.papel]}: {formatarPercentual(regra.percentual)}
                            {ROTULO_CONDICAO[regra.condicao]}
                          </span>
                        ))}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equipes marcadas para regras condicionais</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Algumas regras só valem para determinadas equipes — por exemplo, a gerência receber
            sobre as vendas de uma supervisão específica. Marque aqui quais equipes entram nessas
            regras, em vez de escrever nomes na tabela.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Situação</Th>
                {podeEditar ? <Th>Ações</Th> : null}
              </tr>
            </Cabecalho>
            <tbody>
              {equipes.length === 0 ? (
                <TabelaVazia colunas={podeEditar ? 4 : 3} mensagem="Nenhuma equipe ativa." />
              ) : (
                equipes.map((equipe) => (
                  <Tr key={equipe.id}>
                    <Td className="font-medium">{equipe.nome}</Td>
                    <Td>{equipe.gerencia.nome}</Td>
                    <Td>
                      <Badge tom={equipe.habilitadaComissao ? "bom" : "neutro"}>
                        {equipe.habilitadaComissao ? "Marcada" : "Não marcada"}
                      </Badge>
                    </Td>
                    {podeEditar ? (
                      <Td>
                        <BotaoAlternarEquipe
                          id={equipe.id}
                          habilitada={equipe.habilitadaComissao}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modalidades Flex</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Modalidade</Th>
                <Th className="text-right">Percentual</Th>
                <Th>Status</Th>
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
  );
}

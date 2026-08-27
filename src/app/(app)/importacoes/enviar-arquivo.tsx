"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, Upload } from "lucide-react";
import { formatarMoeda, formatarNumero } from "@/lib/format";
import { Botao, Campo, Card, CardContent, CardHeader, CardTitle, Entrada, Selecao } from "@/components/ui";

interface ResumoBase {
  criados: number;
  atualizados: number;
  inalterados: number;
  duplicados: number;
  cancelados: number;
  contemplados: number;
  erros: number;
  totalLinhas: number;
  estornosGerados: number;
  vendedoresCriados: number;
}

interface ResumoComissao {
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  semCotaVinculada: number;
  semCategoria: number;
  comissaoWrCalculada: number;
  valorComissaoRelatorio: number;
  valorComissaoWr: number;
  divergenciaLeitura: number | null;
}

interface ResumoBonus {
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  semCotaVinculada: number;
  semGerencia: number;
  valorTotal: number;
  totalRelatorio: number | null;
  divergenciaLeitura: number | null;
}

interface ProblemaLeitura {
  aba: string;
  numeroLinha: number;
  mensagem: string;
}

interface Pendencia {
  motivo: string;
  referencia: string;
  detalhe: string;
}

interface ResumoCadastro {
  totalLinhas: number;
  gerenciasCriadas: number;
  equipesCriadas: number;
  pessoasCriadas: number;
  pessoasExistentes: number;
  documentosVinculados: number;
  alocacoesAtualizadas: number;
  situacoesAtualizadas: number;
  periodosDeCategoria: number;
  vendedoresConciliados: number;
  problemas: ProblemaLeitura[];
  pendencias: Pendencia[];
}

interface ResumoComissaoVendedor {
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  vendedores: number;
  semVendedorCadastrado: number;
  valorTotal: number;
  totalRelatorio: number | null;
  divergenciaLeitura: number | null;
}

type Resposta =
  | { tipo: "COMISSAO_VENDEDOR_PDF"; resumo: ResumoComissaoVendedor }
  | { tipo: "BASE_CSV"; resumo: ResumoBase }
  | { tipo: "COMISSAO_PDF"; resumo: ResumoComissao }
  | { tipo: "BONUS_PDF"; resumo: ResumoBonus }
  | { tipo: "CADASTRO_XLSX"; resumo: ResumoCadastro };

export function EnviarArquivo({
  administradoras,
}: {
  administradoras: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const formularioRef = useRef<HTMLFormElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [tipo, setTipo] = useState("BASE_CSV");
  const cadastro = tipo === "CADASTRO_XLSX";

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;

    setEnviando(true);
    setErro(null);
    setResposta(null);

    try {
      const resultado = await fetch("/api/importacoes", {
        method: "POST",
        body: new FormData(formulario),
      });

      const corpo = await resultado.json();
      if (!resultado.ok) {
        setErro(corpo.erro ?? "Falha ao importar o arquivo.");
        return;
      }

      setResposta(corpo as Resposta);
      formulario.reset();
      router.refresh();
    } catch {
      setErro("Não foi possível enviar o arquivo. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Nova importação
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formularioRef} onSubmit={enviar} className="flex flex-col gap-4">
          {erro ? (
            <p
              role="alert"
              className="rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-critico)]"
            >
              {erro}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Tipo de arquivo">
              <Selecao name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="BASE_CSV">Base de clientes (CSV)</option>
                <option value="COMISSAO_PDF">Comissão que a WR recebe (PDF)</option>
                <option value="COMISSAO_VENDEDOR_PDF">
                  Comissão paga direto ao vendedor (PDF)
                </option>
                <option value="BONUS_PDF">Bônus de incentivo da WR (PDF)</option>
                <option value="CADASTRO_XLSX">Cadastro de vendedores da WR (Excel)</option>
              </Selecao>
            </Campo>

            <Campo
              rotulo="Administradora"
              dica={cadastro ? "Não se aplica: o cadastro é da WR" : undefined}
            >
              <Selecao
                name="administradoraId"
                required={!cadastro}
                disabled={cadastro}
                defaultValue={administradoras[0]?.id ?? ""}
              >
                {administradoras.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>

            <Campo
              rotulo="Arquivo"
              dica={
                cadastro
                  ? "Planilha .xlsx com as abas VENDEDORES, HISTORICO CATEGORIA e NOMES DE CADASTRO"
                  : tipo === "BASE_CSV"
                    ? "Arquivo .csv da administradora"
                    : "Fechamento em .pdf"
              }
            >
              <Entrada
                type="file"
                name="arquivo"
                required
                accept={
                  cadastro
                    ? ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    : tipo === "BASE_CSV"
                      ? ".csv,text/csv"
                      : ".pdf,application/pdf"
                }
                className="pt-2 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-superficie-3)] file:px-3 file:py-1 file:text-sm"
              />
            </Campo>
          </div>

          <div>
            <Botao
              type="submit"
              disabled={enviando || (!cadastro && administradoras.length === 0)}
            >
              {tipo === "BASE_CSV" || cadastro ? (
                <FileSpreadsheet className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {enviando ? "Processando arquivo…" : "Importar"}
            </Botao>
          </div>

          {enviando ? (
            <p className="text-sm text-[var(--color-texto-2)]">
              Lendo o arquivo e aplicando as regras. Não feche esta página.
            </p>
          ) : null}

          {resposta?.tipo === "BASE_CSV" ? <ResumoDaBase resumo={resposta.resumo} /> : null}
          {resposta?.tipo === "COMISSAO_PDF" ? (
            <ResumoDaComissao resumo={resposta.resumo} />
          ) : null}
          {resposta?.tipo === "BONUS_PDF" ? <ResumoDoBonus resumo={resposta.resumo} /> : null}
          {resposta?.tipo === "COMISSAO_VENDEDOR_PDF" ? (
            <ResumoDaComissaoVendedor resumo={resposta.resumo} />
          ) : null}
          {resposta?.tipo === "CADASTRO_XLSX" ? (
            <ResumoDoCadastro resumo={resposta.resumo} />
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function ResumoDaBase({ resumo }: { resumo: ResumoBase }) {
  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-superficie-3)] p-4">
      <p className="mb-3 text-sm font-medium">Resumo da importação</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="Novos registros" valor={formatarNumero(resumo.criados)} destaque="bom" />
        <Item rotulo="Atualizados" valor={formatarNumero(resumo.atualizados)} />
        <Item rotulo="Cancelados" valor={formatarNumero(resumo.cancelados)} />
        <Item rotulo="Contemplados" valor={formatarNumero(resumo.contemplados)} />
        <Item rotulo="Duplicados" valor={formatarNumero(resumo.duplicados)} />
        <Item
          rotulo="Erros"
          valor={formatarNumero(resumo.erros)}
          destaque={resumo.erros > 0 ? "critico" : undefined}
        />
        <Item rotulo="Sem alteração" valor={formatarNumero(resumo.inalterados)} />
        <Item rotulo="Linhas lidas" valor={formatarNumero(resumo.totalLinhas)} />
        <Item
          rotulo="Estornos gerados"
          valor={formatarNumero(resumo.estornosGerados)}
          destaque={resumo.estornosGerados > 0 ? "atencao" : undefined}
        />
        <Item
          rotulo="Vendedores criados"
          valor={formatarNumero(resumo.vendedoresCriados)}
          destaque={resumo.vendedoresCriados > 0 ? "atencao" : undefined}
        />
      </dl>
      {resumo.vendedoresCriados > 0 ? (
        <p className="mt-3 text-xs text-[var(--color-texto-2)]">
          Vendedores criados automaticamente ficam sem categoria definida e não geram comissão WR
          até que o RH registre a categoria com a data de início correta.
        </p>
      ) : null}
    </div>
  );
}

function ResumoDaComissao({ resumo }: { resumo: ResumoComissao }) {
  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-superficie-3)] p-4">
      <p className="mb-3 text-sm font-medium">Resumo da importação</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Item rotulo="Lançamentos lidos" valor={formatarNumero(resumo.totalRegistros)} />
        <Item rotulo="Importados" valor={formatarNumero(resumo.criados)} destaque="bom" />
        <Item rotulo="Já existentes" valor={formatarNumero(resumo.duplicados)} />
        <Item
          rotulo="Erros"
          valor={formatarNumero(resumo.erros)}
          destaque={resumo.erros > 0 ? "critico" : undefined}
        />
        <Item rotulo="Valor do relatório" valor={formatarMoeda(resumo.valorComissaoRelatorio)} />
        <Item rotulo="Comissão WR calculada" valor={formatarMoeda(resumo.valorComissaoWr)} />
        <Item
          rotulo="Sem cota vinculada"
          valor={formatarNumero(resumo.semCotaVinculada)}
          destaque={resumo.semCotaVinculada > 0 ? "atencao" : undefined}
        />
        <Item
          rotulo="Sem categoria da venda"
          valor={formatarNumero(resumo.semCategoria)}
          destaque={resumo.semCategoria > 0 ? "atencao" : undefined}
        />
      </dl>

      {resumo.divergenciaLeitura !== null && resumo.divergenciaLeitura !== 0 ? (
        <p className="mt-3 text-xs text-[var(--color-critico)]">
          Atenção: a soma dos lançamentos lidos difere do total impresso no relatório em{" "}
          {formatarMoeda(resumo.divergenciaLeitura)}. Confira o arquivo antes de usar os números.
        </p>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-bom)]">
          Conferência: a soma dos lançamentos lidos bate exatamente com o total impresso no
          relatório.
        </p>
      )}
    </div>
  );
}

function Item({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: "bom" | "atencao" | "critico";
}) {
  const cor =
    destaque === "bom"
      ? "text-[var(--color-bom)]"
      : destaque === "atencao"
        ? "text-[var(--color-atencao)]"
        : destaque === "critico"
          ? "text-[var(--color-critico)]"
          : "text-[var(--color-texto)]";

  return (
    <div>
      <dt className="text-xs text-[var(--color-texto-3)]">{rotulo}</dt>
      <dd className={`numerico text-lg font-semibold ${cor}`}>{valor}</dd>
    </div>
  );
}

function ResumoDoBonus({ resumo }: { resumo: ResumoBonus }) {
  const divergente = resumo.divergenciaLeitura !== null && resumo.divergenciaLeitura !== 0;

  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-superficie-3)] p-4">
      <p className="mb-3 text-sm font-medium">Resumo do bônus</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="Linhas gravadas" valor={formatarNumero(resumo.criados)} destaque="bom" />
        <Item rotulo="Já existentes" valor={formatarNumero(resumo.duplicados)} />
        <Item
          rotulo="Erros"
          valor={formatarNumero(resumo.erros)}
          destaque={resumo.erros > 0 ? "critico" : undefined}
        />
        <Item rotulo="Total do bônus" valor={formatarMoeda(resumo.valorTotal)} destaque="bom" />
        <Item
          rotulo="Impresso no relatório"
          valor={resumo.totalRelatorio === null ? "—" : formatarMoeda(resumo.totalRelatorio)}
        />
        <Item
          rotulo="Divergência de leitura"
          valor={resumo.divergenciaLeitura === null ? "—" : formatarMoeda(resumo.divergenciaLeitura)}
          destaque={divergente ? "critico" : "bom"}
        />
        <Item
          rotulo="Sem cota na base"
          valor={formatarNumero(resumo.semCotaVinculada)}
          destaque={resumo.semCotaVinculada > 0 ? "atencao" : undefined}
        />
        <Item
          rotulo="Sem gerência"
          valor={formatarNumero(resumo.semGerencia)}
          destaque={resumo.semGerencia > 0 ? "atencao" : undefined}
        />
      </dl>
      {resumo.semGerencia > 0 ? (
        <p className="mt-3 text-sm text-[var(--color-texto-2)]">
          As linhas sem gerência entram no total assim mesmo — o valor é da WR de qualquer forma.
          Elas aparecem separadas no rateio, e passam a ser atribuídas assim que a cota
          correspondente estiver na base.
        </p>
      ) : null}
    </div>
  );
}

function ResumoDaComissaoVendedor({ resumo }: { resumo: ResumoComissaoVendedor }) {
  const divergente = resumo.divergenciaLeitura !== null && resumo.divergenciaLeitura !== 0;

  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-superficie-3)] p-4">
      <p className="mb-1 text-sm font-medium">Resumo da comissão dos vendedores</p>
      <p className="mb-3 text-sm text-[var(--color-texto-2)]">
        Este relatório é o que a administradora paga direto ao vendedor. Nada aqui vira obrigação
        de pagamento da WR — entra para conferência.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="Lançamentos" valor={formatarNumero(resumo.criados)} destaque="bom" />
        <Item rotulo="Vendedores" valor={formatarNumero(resumo.vendedores)} />
        <Item rotulo="Já existentes" valor={formatarNumero(resumo.duplicados)} />
        <Item
          rotulo="Erros"
          valor={formatarNumero(resumo.erros)}
          destaque={resumo.erros > 0 ? "critico" : undefined}
        />
        <Item rotulo="Total pago aos vendedores" valor={formatarMoeda(resumo.valorTotal)} />
        <Item
          rotulo="Divergência de leitura"
          valor={resumo.divergenciaLeitura === null ? "—" : formatarMoeda(resumo.divergenciaLeitura)}
          destaque={divergente ? "critico" : "bom"}
        />
        <Item
          rotulo="Sem vendedor cadastrado"
          valor={formatarNumero(resumo.semVendedorCadastrado)}
          destaque={resumo.semVendedorCadastrado > 0 ? "atencao" : undefined}
        />
      </dl>
    </div>
  );
}

/**
 * Resumo do cadastro.
 *
 * As pendências aparecem inteiras, e não como contagem. Cada uma é um vendedor
 * cuja comissão vai sair errada até alguém agir, e o nome dele é a única coisa
 * que torna isso acionável — "12 pendências" não diz a ninguém o que fazer.
 */
function ResumoDoCadastro({ resumo }: { resumo: ResumoCadastro }) {
  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-superficie-3)] p-4">
      <p className="mb-3 text-sm font-medium">Resumo da importação</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="Pessoas criadas" valor={formatarNumero(resumo.pessoasCriadas)} destaque="bom" />
        <Item rotulo="Pessoas já existentes" valor={formatarNumero(resumo.pessoasExistentes)} />
        <Item
          rotulo="Documentos vinculados"
          valor={formatarNumero(resumo.documentosVinculados)}
          destaque="bom"
        />
        <Item rotulo="Gerências criadas" valor={formatarNumero(resumo.gerenciasCriadas)} />
        <Item rotulo="Equipes criadas" valor={formatarNumero(resumo.equipesCriadas)} />
        <Item rotulo="Alocações aplicadas" valor={formatarNumero(resumo.alocacoesAtualizadas)} />
        <Item rotulo="Situações atualizadas" valor={formatarNumero(resumo.situacoesAtualizadas)} />
        <Item
          rotulo="Períodos de categoria"
          valor={formatarNumero(resumo.periodosDeCategoria)}
          destaque="bom"
        />
        <Item
          rotulo="Pendências"
          valor={formatarNumero(resumo.pendencias.length)}
          destaque={resumo.pendencias.length > 0 ? "atencao" : undefined}
        />
        <Item
          rotulo="Erros de preenchimento"
          valor={formatarNumero(resumo.problemas.length)}
          destaque={resumo.problemas.length > 0 ? "critico" : undefined}
        />
      </dl>

      {resumo.problemas.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-[var(--color-critico)]">
            Erros de preenchimento na planilha
          </p>
          <ul className="flex flex-col gap-1 text-sm text-[var(--color-texto-2)]">
            {resumo.problemas.map((problema, indice) => (
              <li key={indice}>
                <span className="font-medium">
                  {problema.aba}, linha {problema.numeroLinha}:
                </span>{" "}
                {problema.mensagem}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {resumo.pendencias.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-[var(--color-atencao)]">
            Pendências — o cadastro entrou, mas estes pontos ficaram em aberto
          </p>
          <ul className="flex flex-col gap-1 text-sm text-[var(--color-texto-2)]">
            {resumo.pendencias.map((pendencia, indice) => (
              <li key={indice}>
                <span className="font-medium">{pendencia.referencia}:</span> {pendencia.detalhe}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

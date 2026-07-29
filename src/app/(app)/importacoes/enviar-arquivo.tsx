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

type Resposta =
  | { tipo: "BASE_CSV"; resumo: ResumoBase }
  | { tipo: "COMISSAO_PDF"; resumo: ResumoComissao };

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
                <option value="COMISSAO_PDF">Relatório de comissão (PDF)</option>
              </Selecao>
            </Campo>

            <Campo rotulo="Administradora">
              <Selecao name="administradoraId" required defaultValue={administradoras[0]?.id ?? ""}>
                {administradoras.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>

            <Campo
              rotulo="Arquivo"
              dica={tipo === "BASE_CSV" ? "Arquivo .csv da administradora" : "Fechamento em .pdf"}
            >
              <Entrada
                type="file"
                name="arquivo"
                required
                accept={tipo === "BASE_CSV" ? ".csv,text/csv" : ".pdf,application/pdf"}
                className="pt-2 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-superficie-3)] file:px-3 file:py-1 file:text-sm"
              />
            </Campo>
          </div>

          <div>
            <Botao type="submit" disabled={enviando || administradoras.length === 0}>
              {tipo === "BASE_CSV" ? (
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

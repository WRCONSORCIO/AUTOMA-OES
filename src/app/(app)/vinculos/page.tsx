import type { Metadata } from "next";
import { CircleCheckBig, Link2, Users } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { sugerirVinculos } from "@/server/services/pessoas";
import { formatarNumero } from "@/lib/format";
import {
  Aviso,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Indicador } from "@/components/indicador";
import { CartaoSugestao, VincularTudo, VinculoManual } from "./formularios";

export const metadata: Metadata = { title: "Vínculos de vendedores" };

export default async function PaginaVinculos() {
  await exigirPermissao("vendedores", "editar");

  const [sugestoes, vendedores, totalPessoas] = await Promise.all([
    sugerirVinculos(),
    prisma.vendedor.findMany({
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        pessoaId: true,
        pessoa: { select: { _count: { select: { documentos: true } } } },
      },
      orderBy: { nome: "asc" },
    }),
    prisma.pessoa.count({ where: { documentos: { some: {} } } }),
  ]);

  const opcoes = vendedores.map((vendedor) => ({
    vendedorId: vendedor.id,
    pessoaId: vendedor.pessoaId ?? "",
    nome: vendedor.nome,
    cpfCnpj: vendedor.cpfCnpj,
    tipo:
      vendedor.cpfCnpj.length === 11 ? "CPF" : vendedor.cpfCnpj.length === 14 ? "CNPJ" : "OUTRO",
    documentosNaPessoa: vendedor.pessoa?._count.documentos ?? 1,
  }));

  const comMaisDeUm = opcoes.filter((opcao) => opcao.documentosNaPessoa > 1).length;

  const totais = { CERTO: 0, ALTA: 0, MEDIA: 0, BAIXA: 0 };
  for (const sugestao of sugestoes) totais[sugestao.confianca] += 1;

  return (
    <>
      <CabecalhoPagina
        titulo="Vínculos de vendedores"
        descricao="O vendedor entra vendendo no CPF e passa a operar por CNPJ ao mudar de categoria. Aqui os documentos da mesma pessoa são reunidos."
      />

      <Aviso tom="marca">
        Depois de vinculados, categoria e recuperação passam a valer para todos os documentos da
        pessoa, e os rankings somam as vendas numa linha só. As vendas já importadas não mudam:
        cada uma guarda a categoria da data em que foi feita.
      </Aviso>

      <section className="grid gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Cadastros"
          valor={formatarNumero(vendedores.length)}
          detalhe="Um por CPF ou CNPJ"
          icone={<Users className="h-4 w-4" />}
        />
        <Indicador rotulo="Pessoas" valor={formatarNumero(totalPessoas)} />
        <Indicador
          rotulo="Cadastros já vinculados"
          valor={formatarNumero(comMaisDeUm)}
          icone={<Link2 className="h-4 w-4" />}
          tom={comMaisDeUm > 0 ? "bom" : "neutro"}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Sugestões automáticas</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Todos os cadastros são varridos, inclusive os que aparecem em Pendências. A razão
            social do CNPJ raramente repete o nome do CPF — ganha sufixo, abrevia um sobrenome ou
            carrega o próprio CPF do dono, e cada caso desses é reconhecido aqui com o motivo à
            vista.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sugestoes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CircleCheckBig className="h-8 w-8 text-[var(--color-bom)]" />
              <p className="text-sm text-[var(--color-texto-2)]">
                Nenhuma sugestão pendente. Cadastros que o sistema não consegue relacionar sozinho
                precisam do vínculo manual abaixo.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-3)] p-4">
                <p className="mb-1 text-sm font-medium">
                  {formatarNumero(sugestoes.length)} sugestão(ões) — aplique de uma vez
                </p>
                <p className="mb-3 text-sm text-[var(--color-texto-2)]">
                  Cada vínculo fica registrado na auditoria e pode ser desfeito depois, cadastro
                  por cadastro, na ficha do vendedor.
                </p>
                <VincularTudo totais={totais} />
              </div>

              {sugestoes.map((sugestao) => (
                <CartaoSugestao
                  key={sugestao.chave}
                  documentos={sugestao.documentos}
                  confianca={sugestao.confianca}
                  motivos={sugestao.motivos}
                />
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vínculo manual</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Para os CNPJs que vêm com razão social diferente do nome do vendedor.
          </p>
        </CardHeader>
        <CardContent>
          <VinculoManual vendedores={opcoes} />
        </CardContent>
      </Card>
    </>
  );
}

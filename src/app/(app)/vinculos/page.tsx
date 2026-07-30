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
import { CartaoSugestao, VinculoManual } from "./formularios";

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
          <CardTitle>Sugestões por nome</CardTitle>
          <p className="text-sm text-[var(--color-texto-2)]">
            Cadastros com o mesmo nome que ainda estão em pessoas diferentes. Confira antes de
            confirmar — nada é vinculado sozinho.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sugestoes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CircleCheckBig className="h-8 w-8 text-[var(--color-bom)]" />
              <p className="text-sm text-[var(--color-texto-2)]">
                Nenhuma sugestão pendente. Cadastros com nomes diferentes precisam do vínculo
                manual abaixo.
              </p>
            </div>
          ) : (
            sugestoes.map((sugestao) => (
              <CartaoSugestao key={sugestao.chave} documentos={sugestao.documentos} />
            ))
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

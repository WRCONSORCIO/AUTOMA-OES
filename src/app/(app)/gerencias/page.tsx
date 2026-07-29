import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarNumero } from "@/lib/format";
import {
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
import { FormularioGerencia, LinhaGerencia } from "./formularios";

export const metadata: Metadata = { title: "Gerências" };

export default async function PaginaGerencias() {
  const sessao = await exigirPermissao("gerencias");
  const podeEditar = podeAcessar(sessao.perfil, "gerencias", "editar");

  const gerencias = await prisma.gerencia.findMany({
    include: { _count: { select: { equipes: true, vendedores: true, cotas: true } } },
    orderBy: [{ status: "asc" }, { nome: "asc" }],
  });

  return (
    <>
      <CabecalhoPagina
        titulo="Gerências"
        descricao="Estrutura de gerências da WR. Gerências não são excluídas — para tirá-las de uso, mude o status para inativo."
      />

      {podeAcessar(sessao.perfil, "gerencias", "criar") ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Nova gerência
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormularioGerencia />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Nome</Th>
                <Th>Status</Th>
                <Th className="text-right">Equipes</Th>
                <Th className="text-right">Vendedores</Th>
                <Th className="text-right">Cotas</Th>
                {podeEditar ? <Th>Ações</Th> : null}
              </tr>
            </Cabecalho>
            <tbody>
              {gerencias.length === 0 ? (
                <TabelaVazia colunas={podeEditar ? 6 : 5} mensagem="Nenhuma gerência cadastrada." />
              ) : (
                gerencias.map((gerencia) =>
                  podeEditar ? (
                    <LinhaGerencia
                      key={gerencia.id}
                      gerencia={{
                        id: gerencia.id,
                        nome: gerencia.nome,
                        status: gerencia.status,
                        equipes: gerencia._count.equipes,
                        vendedores: gerencia._count.vendedores,
                        cotas: gerencia._count.cotas,
                      }}
                    />
                  ) : (
                    <Tr key={gerencia.id}>
                      <Td className="font-medium">{gerencia.nome}</Td>
                      <Td>
                        <Badge tom={gerencia.status === "ATIVO" ? "bom" : "neutro"}>
                          {gerencia.status}
                        </Badge>
                      </Td>
                      <Td className="numerico text-right">
                        {formatarNumero(gerencia._count.equipes)}
                      </Td>
                      <Td className="numerico text-right">
                        {formatarNumero(gerencia._count.vendedores)}
                      </Td>
                      <Td className="numerico text-right">
                        {formatarNumero(gerencia._count.cotas)}
                      </Td>
                    </Tr>
                  ),
                )
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

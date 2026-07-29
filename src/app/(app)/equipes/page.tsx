import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { escopoDoUsuario, podeAcessar } from "@/server/auth/rbac";
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
import { FormularioEquipe, LinhaEquipe } from "./formularios";

export const metadata: Metadata = { title: "Equipes" };

export default async function PaginaEquipes() {
  const sessao = await exigirPermissao("equipes");
  const escopo = escopoDoUsuario(sessao);
  const podeEditar = podeAcessar(sessao.perfil, "equipes", "editar");

  const [equipes, gerencias] = await Promise.all([
    prisma.equipe.findMany({
      where: {
        ...(escopo.gerenciaId ? { gerenciaId: escopo.gerenciaId } : {}),
        ...(escopo.equipeId ? { id: escopo.equipeId } : {}),
      },
      include: {
        gerencia: { select: { id: true, nome: true } },
        _count: { select: { vendedores: true, cotas: true } },
      },
      orderBy: [{ status: "asc" }, { nome: "asc" }],
    }),
    prisma.gerencia.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Equipes"
        descricao="Cada equipe pertence a uma única gerência. Equipes não são excluídas — use o status para tirá-las de operação."
      />

      {podeAcessar(sessao.perfil, "equipes", "criar") ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-4 w-4" />
              Nova equipe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormularioEquipe gerencias={gerencias} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Equipe</Th>
                <Th>Gerência</Th>
                <Th>Status</Th>
                <Th className="text-right">Vendedores</Th>
                <Th className="text-right">Cotas</Th>
                {podeEditar ? <Th>Ações</Th> : null}
              </tr>
            </Cabecalho>
            <tbody>
              {equipes.length === 0 ? (
                <TabelaVazia colunas={podeEditar ? 6 : 5} mensagem="Nenhuma equipe cadastrada." />
              ) : (
                equipes.map((equipe) =>
                  podeEditar ? (
                    <LinhaEquipe
                      key={equipe.id}
                      equipe={{
                        id: equipe.id,
                        nome: equipe.nome,
                        status: equipe.status,
                        gerenciaId: equipe.gerenciaId,
                        gerenciaNome: equipe.gerencia.nome,
                        vendedores: equipe._count.vendedores,
                        cotas: equipe._count.cotas,
                      }}
                      gerencias={gerencias}
                    />
                  ) : (
                    <Tr key={equipe.id}>
                      <Td className="font-medium">{equipe.nome}</Td>
                      <Td>{equipe.gerencia.nome}</Td>
                      <Td>
                        <Badge tom={equipe.status === "ATIVO" ? "bom" : "neutro"}>
                          {equipe.status}
                        </Badge>
                      </Td>
                      <Td className="numerico text-right">
                        {formatarNumero(equipe._count.vendedores)}
                      </Td>
                      <Td className="numerico text-right">{formatarNumero(equipe._count.cotas)}</Td>
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

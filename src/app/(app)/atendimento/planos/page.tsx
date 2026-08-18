import type { Metadata } from "next";
import { PackagePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import {
  Aviso,
  Cabecalho,
  CabecalhoPagina,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabela,
  TabelaVazia,
  Th,
} from "@/components/ui";
import { LinhaPlano, NovoPlano, type PlanoLinha } from "./formularios";

export const metadata: Metadata = { title: "Planos" };

export default async function PaginaPlanos() {
  const sessao = await exigirPermissao("planos");
  const podeCriar = podeAcessar(sessao.perfil, "planos", "criar");
  const podeEditar = podeAcessar(sessao.perfil, "planos", "editar");
  const podeExcluir = podeAcessar(sessao.perfil, "planos", "excluir");

  const planos = await prisma.plano.findMany({
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    include: { _count: { select: { pedidos: true } } },
  });

  const linhas: PlanoLinha[] = planos.map((plano) => ({
    id: plano.id,
    nome: plano.nome,
    descricao: plano.descricao,
    duracaoDias: plano.duracaoDias,
    preco: plano.preco.toString(),
    moeda: plano.moeda,
    status: plano.status,
    ordem: plano.ordem,
    destaque: plano.destaque,
    textoCliente: plano.textoCliente,
    pedidos: plano._count.pedidos,
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Planos"
        descricao="O que o bot oferece ao cliente. A ordem aqui é a ordem da lista enviada no WhatsApp; plano inativo simplesmente não aparece."
      />

      {linhas.length === 0 ? (
        <Aviso tom="atencao">
          Nenhum plano cadastrado. Sem plano ativo o bot não consegue avançar para o pagamento.
        </Aviso>
      ) : null}

      {podeCriar ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4" />
              Novo plano
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NovoPlano />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Plano</Th>
                <Th className="text-right">Duração</Th>
                <Th className="text-right">Preço</Th>
                <Th className="text-right">Pedidos</Th>
                <Th>Status</Th>
                <Th>Ordem</Th>
                <Th>Ações</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {linhas.length === 0 ? (
                <TabelaVazia colunas={7} mensagem="Nenhum plano cadastrado." />
              ) : (
                linhas.map((plano) => (
                  <LinhaPlano
                    key={plano.id}
                    plano={plano}
                    podeEditar={podeEditar}
                    podeExcluir={podeExcluir}
                  />
                ))
              )}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>
    </>
  );
}

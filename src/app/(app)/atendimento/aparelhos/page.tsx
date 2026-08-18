import type { Metadata } from "next";
import { MonitorSmartphone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import {
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
import { LinhaAparelho, NovoAparelho, type AparelhoLinha } from "./formularios";

export const metadata: Metadata = { title: "Aparelhos" };

export default async function PaginaAparelhos() {
  const sessao = await exigirPermissao("aparelhos");
  const podeCriar = podeAcessar(sessao.perfil, "aparelhos", "criar");
  const podeEditar = podeAcessar(sessao.perfil, "aparelhos", "editar");
  const podeExcluir = podeAcessar(sessao.perfil, "aparelhos", "excluir");

  const [aparelhos, fluxos] = await Promise.all([
    prisma.aparelho.findMany({
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      include: { fluxo: { select: { nome: true } }, _count: { select: { opcoes: true } } },
    }),
    prisma.fluxo.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const linhas: AparelhoLinha[] = aparelhos.map((aparelho) => ({
    id: aparelho.id,
    chave: aparelho.chave,
    nome: aparelho.nome,
    icone: aparelho.icone,
    status: aparelho.status,
    ordem: aparelho.ordem,
    fluxoId: aparelho.fluxoId,
    fluxoNome: aparelho.fluxo?.nome ?? null,
    instrucoes: aparelho.instrucoes,
    usadoEmFluxos: aparelho._count.opcoes,
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Aparelhos"
        descricao="Os aparelhos oferecidos depois do pagamento confirmado. A lista sai daqui, não do código: criar, reordenar ou desativar muda o WhatsApp na hora."
      />

      {podeCriar ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4" />
              Novo aparelho
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NovoAparelho fluxos={fluxos} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Aparelho</Th>
                <Th>Fluxo</Th>
                <Th>Status</Th>
                <Th className="text-right">Posição</Th>
                <Th>Ordem</Th>
                <Th>Ações</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {linhas.length === 0 ? (
                <TabelaVazia colunas={6} mensagem="Nenhum aparelho cadastrado." />
              ) : (
                linhas.map((aparelho) => (
                  <LinhaAparelho
                    key={aparelho.id}
                    aparelho={aparelho}
                    fluxos={fluxos}
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

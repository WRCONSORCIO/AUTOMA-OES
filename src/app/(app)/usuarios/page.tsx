import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar, ROTULO_PERFIL } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { formatarDataHora } from "@/lib/format";
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
import { AcoesUsuario, NovoUsuario } from "./formularios";

export const metadata: Metadata = { title: "Usuários" };

export default async function PaginaUsuarios() {
  const sessao = await exigirPermissao("usuarios");
  const podeEditar = podeAcessar(sessao.perfil, "usuarios", "editar");

  const [usuarios, gerencias, equipes] = await Promise.all([
    prisma.usuario.findMany({
      include: {
        gerencia: { select: { nome: true } },
        equipe: { select: { nome: true } },
      },
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    }),
    prisma.gerencia.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    prisma.equipe.findMany({
      where: { status: "ATIVO" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Contas de acesso e perfis. Usuários nunca são excluídos — o acesso é revogado pela inativação, preservando o vínculo com o histórico de auditoria."
      />

      {podeAcessar(sessao.perfil, "usuarios", "criar") ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-4 w-4" />
              Novo usuário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NovoUsuario gerencias={gerencias} equipes={equipes} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Nome</Th>
                <Th>E-mail</Th>
                <Th>Perfil</Th>
                <Th>Escopo</Th>
                <Th>Último acesso</Th>
                <Th>Status</Th>
                {podeEditar ? <Th>Ações</Th> : null}
              </tr>
            </Cabecalho>
            <tbody>
              {usuarios.length === 0 ? (
                <TabelaVazia colunas={podeEditar ? 7 : 6} mensagem="Nenhum usuário cadastrado." />
              ) : (
                usuarios.map((usuario) => (
                  <Tr key={usuario.id}>
                    <Td className="font-medium">{usuario.nome}</Td>
                    <Td>{usuario.email}</Td>
                    <Td>
                      <Badge tom="marca">{ROTULO_PERFIL[usuario.perfil]}</Badge>
                    </Td>
                    <Td>
                      {usuario.gerencia?.nome ?? usuario.equipe?.nome ?? (
                        <span className="text-[var(--color-texto-3)]">Todos os dados</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {usuario.ultimoLoginEm ? formatarDataHora(usuario.ultimoLoginEm) : "—"}
                    </Td>
                    <Td>
                      <Badge tom={usuario.ativo ? "bom" : "neutro"}>
                        {usuario.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </Td>
                    {podeEditar ? (
                      <Td>
                        <AcoesUsuario id={usuario.id} ativo={usuario.ativo} />
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

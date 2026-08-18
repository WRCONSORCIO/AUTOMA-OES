import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { Aviso, CabecalhoPagina, Card, CardContent } from "@/components/ui";
import { MODELOS_PADRAO } from "@/server/atendimento/mensagens-padrao";
import { VARIAVEIS_DISPONIVEIS } from "@/server/atendimento/dominio/variaveis";
import { EditorMensagem, type ModeloLinha } from "./formularios";

export const metadata: Metadata = { title: "Mensagens" };

export default async function PaginaMensagens() {
  const sessao = await exigirPermissao("mensagensBot");
  const podeEditar = podeAcessar(sessao.perfil, "mensagensBot", "editar");

  const modelos = await prisma.modeloMensagem.findMany({ orderBy: { titulo: "asc" } });

  const linhas: ModeloLinha[] = modelos.map((modelo) => ({
    chave: modelo.chave,
    titulo: modelo.titulo,
    conteudo: modelo.conteudo,
    descricao: modelo.descricao,
    variaveis: modelo.variaveis,
    temPadrao: MODELOS_PADRAO.some((padrao) => padrao.chave === modelo.chave),
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Mensagens"
        descricao="Os textos que o bot envia. Salvar aqui muda o WhatsApp na hora, sem publicar versão nova do sistema."
      />

      <Aviso tom="marca">
        Variáveis disponíveis:{" "}
        {VARIAVEIS_DISPONIVEIS.map((nome) => `{{${nome}}}`).join(" · ")}. Variável sem valor no
        momento do envio some do texto — ela nunca aparece crua para o cliente.
      </Aviso>

      <Card>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {linhas.map((modelo) => (
            <EditorMensagem key={modelo.chave} modelo={modelo} podeEditar={podeEditar} />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

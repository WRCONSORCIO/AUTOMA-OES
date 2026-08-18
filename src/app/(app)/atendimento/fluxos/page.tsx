import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import {
  Aviso,
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
import { NovoFluxo, ROTULO_TIPO_FLUXO } from "./formularios";

export const metadata: Metadata = { title: "Fluxos" };

export default async function PaginaFluxos() {
  const sessao = await exigirPermissao("fluxos");
  const podeCriar = podeAcessar(sessao.perfil, "fluxos", "criar");

  const fluxos = await prisma.fluxo.findMany({
    include: {
      _count: { select: { etapas: true, conversas: true } },
      etapaInicial: { select: { nome: true } },
    },
    orderBy: [{ tipo: "asc" }, { nome: "asc" }],
  });

  const semPrincipal = !fluxos.some((fluxo) => fluxo.tipo === "PRINCIPAL" && fluxo.status === "ATIVO");
  const semEtapaInicial = fluxos.filter((fluxo) => fluxo.status === "ATIVO" && !fluxo.etapaInicialId);

  return (
    <>
      <CabecalhoPagina
        titulo="Fluxos"
        descricao="As etapas da conversa. Tudo o que o bot diz e para onde ele leva o cliente sai daqui — mudar o atendimento não exige publicar versão nova."
      />

      {semPrincipal ? (
        <Aviso tom="critico">
          Nenhum fluxo principal ativo. Sem ele, toda conversa nova cai direto no atendimento
          humano.
        </Aviso>
      ) : null}

      {semEtapaInicial.length > 0 ? (
        <Aviso tom="atencao">
          Fluxo ativo sem etapa inicial: {semEtapaInicial.map((fluxo) => fluxo.nome).join(", ")}. Um
          fluxo sem etapa inicial não roda.
        </Aviso>
      ) : null}

      {podeCriar ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Novo fluxo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NovoFluxo />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Fluxo</Th>
                <Th>Tipo</Th>
                <Th>Etapa inicial</Th>
                <Th className="text-right">Etapas</Th>
                <Th className="text-right">Conversas</Th>
                <Th>Status</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {fluxos.length === 0 ? (
                <TabelaVazia colunas={6} mensagem="Nenhum fluxo cadastrado." />
              ) : (
                fluxos.map((fluxo) => (
                  <Tr key={fluxo.id}>
                    <Td className="font-medium">
                      <Link href={`/atendimento/fluxos/${fluxo.id}`} className="hover:underline">
                        {fluxo.nome}
                      </Link>
                      <div className="text-xs text-[var(--color-texto-3)]">{fluxo.chave}</div>
                    </Td>
                    <Td>
                      <Badge tom={fluxo.tipo === "PRINCIPAL" ? "marca" : "neutro"}>
                        {ROTULO_TIPO_FLUXO[fluxo.tipo]}
                      </Badge>
                    </Td>
                    <Td className="text-sm">
                      {fluxo.etapaInicial?.nome ?? (
                        <span className="text-[var(--color-critico)]">não definida</span>
                      )}
                    </Td>
                    <Td className="numerico text-right">{fluxo._count.etapas}</Td>
                    <Td className="numerico text-right">{fluxo._count.conversas}</Td>
                    <Td>
                      <Badge tom={fluxo.status === "ATIVO" ? "bom" : "neutro"}>
                        {fluxo.status === "ATIVO" ? "Ativo" : "Inativo"}
                      </Badge>
                    </Td>
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

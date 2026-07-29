import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { formatarBytes, formatarDataHora } from "@/lib/format";
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
import { BotaoGerarBackup } from "./botao";

export const metadata: Metadata = { title: "Backups" };

const TOM_STATUS = {
  PENDENTE: "neutro",
  EXECUTANDO: "marca",
  CONCLUIDO: "bom",
  FALHA: "critico",
} as const;

export default async function PaginaBackups() {
  const sessao = await exigirPermissao("backups");
  const podeGerar = podeAcessar(sessao.perfil, "backups", "criar");

  const backups = await prisma.backup.findMany({
    include: { usuario: { select: { nome: true } } },
    orderBy: { iniciadoEm: "desc" },
    take: 100,
  });

  let retencao = 30;
  let diretorio = "./storage/backups";
  try {
    const configuracao = env();
    retencao = configuracao.BACKUP_RETENTION_DAYS;
    diretorio = configuracao.BACKUP_DIR;
  } catch {
    // Configuração incompleta é sinalizada pelo aviso abaixo.
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Backups"
        descricao="Exportação completa do banco em formato restaurável com pg_restore."
        acoes={podeGerar ? <BotaoGerarBackup /> : null}
      />

      <Aviso tom="marca">
        O backup diário é executado pelo agendador do servidor chamando{" "}
        <code className="numerico">npm run backup:run</code> (ou a rota{" "}
        <code className="numerico">POST /api/backups/cron</code> com o token configurado). Os
        arquivos ficam em <code className="numerico">{diretorio}</code> e são mantidos por{" "}
        {retencao} dias.
      </Aviso>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabela>
            <Cabecalho>
              <tr>
                <Th>Início</Th>
                <Th>Conclusão</Th>
                <Th>Arquivo</Th>
                <Th>Tipo</Th>
                <Th>Solicitado por</Th>
                <Th className="text-right">Tamanho</Th>
                <Th>Status</Th>
              </tr>
            </Cabecalho>
            <tbody>
              {backups.length === 0 ? (
                <TabelaVazia colunas={7} mensagem="Nenhum backup gerado até agora." />
              ) : (
                backups.map((backup) => (
                  <Tr key={backup.id}>
                    <Td className="whitespace-nowrap">{formatarDataHora(backup.iniciadoEm)}</Td>
                    <Td className="whitespace-nowrap">
                      {backup.finalizadoEm ? formatarDataHora(backup.finalizadoEm) : "—"}
                    </Td>
                    <Td className="numerico max-w-72 truncate text-xs" title={backup.nomeArquivo}>
                      {backup.nomeArquivo}
                    </Td>
                    <Td>
                      <Badge tom="neutro">
                        {backup.tipo === "AUTOMATICO" ? "Automático" : "Manual"}
                      </Badge>
                    </Td>
                    <Td>{backup.usuario?.nome ?? "Agendador"}</Td>
                    <Td className="numerico text-right">{formatarBytes(backup.tamanhoBytes)}</Td>
                    <Td>
                      <Badge tom={TOM_STATUS[backup.status]}>{backup.status}</Badge>
                      {backup.erro ? (
                        <p className="mt-1 max-w-72 text-xs text-[var(--color-critico)]">
                          {backup.erro}
                        </p>
                      ) : null}
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

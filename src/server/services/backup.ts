// Sem "server-only": este serviço também roda pelo agendador via `npm run backup:run`.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "./auditoria";
import { prepararConexaoPgDump } from "./conexao-pg";
import type { ContextoUsuario } from "./vendedores";

export interface ResultadoBackup {
  id: string;
  nomeArquivo: string;
  caminho: string;
  tamanhoBytes: number;
}

/**
 * Gera um dump completo do banco com `pg_dump` no formato custom (comprimido e
 * restaurável com `pg_restore`). Backups antigos são removidos conforme a
 * retenção configurada — o banco em si nunca é tocado.
 */
export async function gerarBackup(
  tipo: "AUTOMATICO" | "MANUAL",
  usuario?: ContextoUsuario,
): Promise<ResultadoBackup> {
  const configuracao = env();
  const diretorio = resolve(configuracao.BACKUP_DIR);
  await mkdir(diretorio, { recursive: true });

  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const nomeArquivo = `wr-consorcio-${tipo.toLowerCase()}-${carimbo}.dump`;
  const caminho = join(diretorio, nomeArquivo);

  const registro = await prisma.backup.create({
    data: {
      tipo,
      status: "EXECUTANDO",
      nomeArquivo,
      caminho,
      usuarioId: usuario?.id ?? null,
    },
  });

  try {
    await executarPgDump(configuracao.DATABASE_URL, caminho, tipo);
    const informacoes = await stat(caminho);

    await prisma.backup.update({
      where: { id: registro.id },
      data: {
        status: "CONCLUIDO",
        finalizadoEm: new Date(),
        tamanhoBytes: Number(informacoes.size),
      },
    });

    await registrarAuditoria({
      acao: "BACKUP",
      entidade: "Backup",
      entidadeId: registro.id,
      descricao: `Backup ${tipo.toLowerCase()} gerado (${nomeArquivo})`,
      dadosDepois: { nomeArquivo, tamanhoBytes: informacoes.size },
      usuario: usuario ?? null,
    });

    await aplicarRetencao(diretorio, configuracao.BACKUP_RETENTION_DAYS);

    return {
      id: registro.id,
      nomeArquivo,
      caminho,
      tamanhoBytes: Number(informacoes.size),
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao gerar o backup.";
    await prisma.backup.update({
      where: { id: registro.id },
      data: { status: "FALHA", finalizadoEm: new Date(), erro: mensagem },
    });
    await unlink(caminho).catch(() => undefined);
    throw new Error(`Backup não concluído: ${mensagem}`);
  }
}

function executarPgDump(
  urlBanco: string,
  destino: string,
  tipo: "AUTOMATICO" | "MANUAL",
): Promise<void> {
  return new Promise((cumprir, rejeitar) => {
    const conexao = prepararConexaoPgDump(urlBanco);

    const processo = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--compress=9",
        ...conexao.argumentos,
        conexao.url,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PGAPPNAME: `wr-backup-${tipo.toLowerCase()}` },
      },
    );

    const saida = createWriteStream(destino);
    processo.stdout.pipe(saida);

    let erroPadrao = "";
    processo.stderr.on("data", (pedaco: Buffer) => {
      erroPadrao += pedaco.toString();
    });

    processo.on("error", (erro) => {
      rejeitar(
        new Error(
          `não foi possível executar o pg_dump (${erro.message}). Verifique se o utilitário do PostgreSQL está instalado no servidor.`,
        ),
      );
    });

    processo.on("close", (codigo) => {
      saida.close();
      if (codigo === 0) cumprir();
      else rejeitar(new Error(erroPadrao.trim() || `pg_dump encerrou com código ${codigo}`));
    });
  });
}

async function aplicarRetencao(diretorio: string, dias: number): Promise<void> {
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  const arquivos = await readdir(diretorio).catch(() => [] as string[]);

  for (const arquivo of arquivos) {
    if (!arquivo.endsWith(".dump")) continue;
    const caminho = join(diretorio, arquivo);
    const informacoes = await stat(caminho).catch(() => null);
    if (!informacoes) continue;
    if (informacoes.mtimeMs < limite) {
      await unlink(caminho).catch(() => undefined);
      await prisma.backup.updateMany({
        where: { caminho },
        data: { erro: "Arquivo removido pela política de retenção." },
      });
    }
  }
}

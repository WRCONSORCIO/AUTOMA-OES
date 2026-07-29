/**
 * Backup diário executado pelo agendador do servidor.
 *
 * Exemplo de crontab (03:00 todos os dias):
 *   0 3 * * * cd /opt/wr-consorcio && npm run backup:run >> /var/log/wr-backup.log 2>&1
 */
import { gerarBackup } from "@/server/services/backup";
import { prisma } from "@/lib/prisma";

async function main() {
  const resultado = await gerarBackup("AUTOMATICO");
  console.log(
    `[backup] concluído: ${resultado.nomeArquivo} (${resultado.tamanhoBytes} bytes) em ${resultado.caminho}`,
  );
}

main()
  .catch((erro) => {
    console.error("[backup] falhou:", erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

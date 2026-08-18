/**
 * Manutenção do atendimento pela linha de comando.
 *
 * Expira cobranças vencidas e encerra conversas abandonadas. Mesmo efeito do
 * endpoint `POST /api/atendimento/manutencao`, para quem prefere agendar por
 * cron do sistema em vez de chamada HTTP.
 *
 * Sugestão de agendamento: a cada dez minutos, via cron do sistema. A linha do
 * crontab está no README, em "Manutenção" — ela não cabe aqui porque a sintaxe
 * do cron fecharia este comentário.
 */
import { prisma } from "@/lib/prisma";
import { executarManutencao } from "@/server/atendimento/servicos/manutencao";

async function main() {
  const resumo = await executarManutencao();

  console.log(
    `manutenção concluída — cobranças expiradas: ${resumo.expirados} · ` +
      `conversas encerradas: ${resumo.conversasEncerradas}`,
  );
}

main()
  .catch((erro) => {
    console.error("falha na manutenção do atendimento", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

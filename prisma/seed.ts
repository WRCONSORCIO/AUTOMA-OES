/**
 * Carga inicial pela linha de comando.
 *
 * Alternativa à tela de configuração inicial, útil para automatizar a
 * implantação. Cria a mesma estrutura (administradora, gerências, equipes,
 * modalidades de flex e a tabela de Iniciante) mais o usuário administrador.
 *
 * O cadastro de vendedores não é semeado com dados fictícios: ele vem da
 * importação da base, que traz o CPF/CNPJ real.
 *
 * Idempotente: rodar de novo não duplica nada.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { criarEstruturaInicial } from "@/server/services/instalacao";
import { criarEstruturaAtendimento } from "@/server/atendimento/instalacao";

async function main() {
  const resumo = await criarEstruturaInicial();

  console.log(`administradora: ${resumo.administradora}`);
  console.log(`gerências: ${resumo.gerencias} · equipes: ${resumo.equipes}`);
  console.log(`modalidades flex: ${resumo.modalidades}`);
  if (resumo.tabelaCriada) {
    console.log("tabela de comissão de Iniciante criada (4% / 3% / 2% / 1%)");
  }

  const atendimento = await criarEstruturaAtendimento();
  console.log(
    `atendimento — aparelhos: ${atendimento.aparelhos} · mensagens: ${atendimento.mensagens} · ` +
      `horários: ${atendimento.horarios} · fluxos: ${atendimento.fluxos}`,
  );

  await criarAdministrador();
}

async function criarAdministrador() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@wrconsorcio.com").toLowerCase();

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`usuário administrador já existe: ${email}`);
    return;
  }

  // Sem senha definida no ambiente, geramos uma forte e exibimos uma única vez.
  const senha = process.env.SEED_ADMIN_SENHA ?? randomBytes(12).toString("base64url");

  await prisma.usuario.create({
    data: {
      nome: process.env.SEED_ADMIN_NOME ?? "Administrador WR",
      email,
      senhaHash: await bcrypt.hash(senha, 12),
      perfil: "ADMINISTRADOR",
    },
  });

  console.log("\n────────────────────────────────────────────");
  console.log("Usuário administrador criado");
  console.log(`  e-mail: ${email}`);
  if (!process.env.SEED_ADMIN_SENHA) {
    console.log(`  senha:  ${senha}`);
    console.log("  Anote esta senha: ela não será exibida novamente.");
  }
  console.log("────────────────────────────────────────────\n");
}

main()
  .catch((erro) => {
    console.error("Falha na carga inicial:", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

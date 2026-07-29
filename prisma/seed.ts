/**
 * Carga inicial do sistema.
 *
 * Cria apenas o que é estrutural e verificável: administradora, gerências,
 * equipes, modalidades de flex, a tabela de comissão de Iniciante e o usuário
 * administrador. O cadastro de vendedores não é semeado com dados fictícios —
 * ele vem da importação da base (que traz o CPF/CNPJ real) e é complementado
 * por `scripts/importar-cadastro-vendedores.ts`.
 *
 * O script é idempotente: rodar de novo não duplica nada.
 */
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Estrutura comercial atual da WR: gerência → equipes (supervisões). */
const ESTRUTURA: Record<string, string[]> = {
  CHARLES: ["CHARLES"],
  ERITA: ["ERITA", "SABRINA", "LUCAS"],
  RAFAEL: ["RAFAEL", "NIKSON"],
};

const MODALIDADES_FLEX = [
  { nome: "Integral", percentual: "100.0000" },
  { nome: "Flex 50", percentual: "50.0000" },
  { nome: "Flex 30", percentual: "30.0000" },
];

/** Tabela de Iniciante. Parcelas acima da 4ª não geram comissão WR. */
const FAIXAS_INICIANTE = [
  { parcela: 1, percentual: "4.0000" },
  { parcela: 2, percentual: "3.0000" },
  { parcela: 3, percentual: "2.0000" },
  { parcela: 4, percentual: "1.0000" },
];

async function main() {
  const administradora = await prisma.administradora.upsert({
    where: { nome: "SERVOPA" },
    update: {},
    create: {
      nome: "SERVOPA",
      cnpj: "76.599.633/0001-15",
      codigo: "SERVOPA",
    },
  });
  console.log(`administradora: ${administradora.nome}`);

  for (const [nomeGerencia, equipes] of Object.entries(ESTRUTURA)) {
    const gerencia = await prisma.gerencia.upsert({
      where: { nome: nomeGerencia },
      update: {},
      create: { nome: nomeGerencia },
    });

    for (const nomeEquipe of equipes) {
      await prisma.equipe.upsert({
        where: { gerenciaId_nome: { gerenciaId: gerencia.id, nome: nomeEquipe } },
        update: {},
        create: { nome: nomeEquipe, gerenciaId: gerencia.id },
      });
    }

    console.log(`gerência ${nomeGerencia}: ${equipes.length} equipe(s)`);
  }

  for (const modalidade of MODALIDADES_FLEX) {
    await prisma.modalidadeFlex.upsert({
      where: { nome: modalidade.nome },
      update: {},
      create: {
        nome: modalidade.nome,
        percentual: new Prisma.Decimal(modalidade.percentual),
      },
    });
  }
  console.log(`modalidades flex: ${MODALIDADES_FLEX.length}`);

  const tabelaExistente = await prisma.tabelaComissao.findFirst({
    where: { categoria: "INICIANTE", vigenteAte: null },
  });

  if (!tabelaExistente) {
    await prisma.tabelaComissao.create({
      data: {
        nome: "Iniciante — tabela padrão",
        categoria: "INICIANTE",
        vigenteDe: new Date(Date.UTC(2026, 0, 1)),
        faixas: {
          create: FAIXAS_INICIANTE.map((faixa) => ({
            parcela: faixa.parcela,
            percentual: new Prisma.Decimal(faixa.percentual),
          })),
        },
      },
    });
    console.log("tabela de comissão de Iniciante criada (4% / 3% / 2% / 1%)");
  }

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

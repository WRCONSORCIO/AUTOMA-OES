// Sem "server-only": também é usado pelo `npm run db:seed`, que roda fora do Next.
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Cliente = Prisma.TransactionClient | PrismaClient;

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

/**
 * O sistema é considerado instalado assim que existe pelo menos um usuário.
 * É essa checagem que fecha a tela de configuração inicial.
 */
export async function sistemaInstalado(db: Cliente = prisma): Promise<boolean> {
  const total = await db.usuario.count();
  return total > 0;
}

export interface ResumoInstalacao {
  administradora: string;
  gerencias: number;
  equipes: number;
  modalidades: number;
  tabelaCriada: boolean;
}

/**
 * Cria a estrutura mínima para o sistema operar. Idempotente: rodar de novo
 * não duplica nada, então pode ser chamada pelo seed e pela tela de
 * configuração inicial sem risco.
 */
export async function criarEstruturaInicial(db: Cliente = prisma): Promise<ResumoInstalacao> {
  const administradora = await db.administradora.upsert({
    where: { nome: "SERVOPA" },
    update: {},
    create: { nome: "SERVOPA", cnpj: "76.599.633/0001-15", codigo: "SERVOPA" },
  });

  let totalEquipes = 0;

  for (const [nomeGerencia, equipes] of Object.entries(ESTRUTURA)) {
    const gerencia = await db.gerencia.upsert({
      where: { nome: nomeGerencia },
      update: {},
      create: { nome: nomeGerencia },
    });

    for (const nomeEquipe of equipes) {
      await db.equipe.upsert({
        where: { gerenciaId_nome: { gerenciaId: gerencia.id, nome: nomeEquipe } },
        update: {},
        create: { nome: nomeEquipe, gerenciaId: gerencia.id },
      });
      totalEquipes += 1;
    }
  }

  for (const modalidade of MODALIDADES_FLEX) {
    await db.modalidadeFlex.upsert({
      where: { nome: modalidade.nome },
      update: {},
      create: {
        nome: modalidade.nome,
        percentual: new Prisma.Decimal(modalidade.percentual),
      },
    });
  }

  const tabelaExistente = await db.tabelaComissao.findFirst({
    where: { categoria: "INICIANTE", vigenteAte: null },
  });

  if (!tabelaExistente) {
    await db.tabelaComissao.create({
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
  }

  return {
    administradora: administradora.nome,
    gerencias: Object.keys(ESTRUTURA).length,
    equipes: totalEquipes,
    modalidades: MODALIDADES_FLEX.length,
    tabelaCriada: !tabelaExistente,
  };
}

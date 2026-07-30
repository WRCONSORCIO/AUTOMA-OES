import type { PerfilUsuario } from "@prisma/client";

/**
 * Controle de acesso por perfil.
 *
 * - Administrador: acesso total.
 * - Gerente: enxerga apenas a própria gerência.
 * - Supervisor: enxerga apenas a própria equipe.
 * - Financeiro: apenas módulos financeiros.
 * - RH: apenas módulos de vendedores.
 */

export const MODULOS = [
  "dashboard",
  "vendedores",
  "equipes",
  "gerencias",
  "cotas",
  "transferencias",
  "comissoes",
  "comissoesEquipe",
  "importacoes",
  "tabelas",
  "usuarios",
  "auditoria",
  "backups",
] as const;

export type Modulo = (typeof MODULOS)[number];
export type Acao = "ver" | "criar" | "editar";

type MatrizPerfil = Partial<Record<Modulo, readonly Acao[]>>;

const TODAS: readonly Acao[] = ["ver", "criar", "editar"];
const SOMENTE_LEITURA: readonly Acao[] = ["ver"];

const MATRIZ: Record<PerfilUsuario, MatrizPerfil> = {
  ADMINISTRADOR: Object.fromEntries(
    MODULOS.map((modulo) => [modulo, TODAS]),
  ) as MatrizPerfil,

  GERENTE: {
    dashboard: SOMENTE_LEITURA,
    vendedores: SOMENTE_LEITURA,
    equipes: SOMENTE_LEITURA,
    gerencias: SOMENTE_LEITURA,
    cotas: SOMENTE_LEITURA,
    comissoes: SOMENTE_LEITURA,
    comissoesEquipe: SOMENTE_LEITURA,
  },

  SUPERVISOR: {
    dashboard: SOMENTE_LEITURA,
    vendedores: SOMENTE_LEITURA,
    equipes: SOMENTE_LEITURA,
    cotas: SOMENTE_LEITURA,
    comissoes: SOMENTE_LEITURA,
    comissoesEquipe: SOMENTE_LEITURA,
  },

  FINANCEIRO: {
    dashboard: SOMENTE_LEITURA,
    cotas: SOMENTE_LEITURA,
    comissoes: TODAS,
    comissoesEquipe: TODAS,
    importacoes: TODAS,
    tabelas: TODAS,
  },

  RH: {
    dashboard: SOMENTE_LEITURA,
    comissoesEquipe: SOMENTE_LEITURA,
    vendedores: TODAS,
    equipes: TODAS,
    gerencias: TODAS,
  },
};

export function podeAcessar(
  perfil: PerfilUsuario,
  modulo: Modulo,
  acao: Acao = "ver",
): boolean {
  const acoes = MATRIZ[perfil]?.[modulo];
  if (!acoes) return false;
  return acoes.includes(acao);
}

export function modulosVisiveis(perfil: PerfilUsuario): Modulo[] {
  return MODULOS.filter((modulo) => podeAcessar(perfil, modulo, "ver"));
}

/**
 * Escopo de dados do usuário. Gerente e supervisor só enxergam os registros da
 * própria gerência/equipe; os demais perfis enxergam tudo.
 */
export interface EscopoDados {
  gerenciaId?: string;
  equipeId?: string;
}

export function escopoDoUsuario(usuario: {
  perfil: PerfilUsuario;
  gerenciaId: string | null;
  equipeId: string | null;
}): EscopoDados {
  if (usuario.perfil === "GERENTE" && usuario.gerenciaId) {
    return { gerenciaId: usuario.gerenciaId };
  }
  if (usuario.perfil === "SUPERVISOR" && usuario.equipeId) {
    return { equipeId: usuario.equipeId };
  }
  return {};
}

/**
 * Converte o escopo em cláusula `where` do Prisma. Usado por todos os módulos
 * que listam cotas e comissões, garantindo isolamento consistente.
 */
export function filtroEscopo(escopo: EscopoDados): {
  gerenciaId?: string;
  equipeId?: string;
} {
  const filtro: { gerenciaId?: string; equipeId?: string } = {};
  if (escopo.gerenciaId) filtro.gerenciaId = escopo.gerenciaId;
  if (escopo.equipeId) filtro.equipeId = escopo.equipeId;
  return filtro;
}

export const ROTULO_PERFIL: Record<PerfilUsuario, string> = {
  ADMINISTRADOR: "Administrador",
  GERENTE: "Gerente",
  SUPERVISOR: "Supervisor",
  FINANCEIRO: "Financeiro",
  RH: "RH",
};

import type { Modulo } from "@/server/auth/rbac";

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  modulo: Modulo;
  icone: string;
  grupo: "Operação" | "Cadastros" | "Sistema";
}

/** `icone` referencia a chave do mapa em `sidebar.tsx`. */
export const NAVEGACAO: readonly ItemNavegacao[] = [
  { href: "/", rotulo: "Dashboard", modulo: "dashboard", icone: "dashboard", grupo: "Operação" },
  { href: "/comissoes", rotulo: "Comissões WR", modulo: "comissoes", icone: "comissoes", grupo: "Operação" },
  { href: "/clientes", rotulo: "Clientes (cotas)", modulo: "cotas", icone: "cotas", grupo: "Operação" },
  { href: "/importacoes", rotulo: "Importações", modulo: "importacoes", icone: "importacoes", grupo: "Operação" },

  { href: "/vendedores", rotulo: "Vendedores", modulo: "vendedores", icone: "vendedores", grupo: "Cadastros" },
  { href: "/pendencias", rotulo: "Pendências de cadastro", modulo: "vendedores", icone: "pendencias", grupo: "Cadastros" },
  { href: "/equipes", rotulo: "Equipes", modulo: "equipes", icone: "equipes", grupo: "Cadastros" },
  { href: "/gerencias", rotulo: "Gerências", modulo: "gerencias", icone: "gerencias", grupo: "Cadastros" },
  { href: "/tabelas", rotulo: "Tabelas e Flex", modulo: "tabelas", icone: "tabelas", grupo: "Cadastros" },

  { href: "/usuarios", rotulo: "Usuários", modulo: "usuarios", icone: "usuarios", grupo: "Sistema" },
  { href: "/auditoria", rotulo: "Auditoria", modulo: "auditoria", icone: "auditoria", grupo: "Sistema" },
  { href: "/backups", rotulo: "Backups", modulo: "backups", icone: "backups", grupo: "Sistema" },
];

export const GRUPOS = ["Operação", "Cadastros", "Sistema"] as const;

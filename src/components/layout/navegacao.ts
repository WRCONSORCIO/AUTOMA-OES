import type { Modulo } from "@/server/auth/rbac";

/**
 * Navegação em **seis módulos**.
 *
 * Antes eram quinze itens soltos em três grupos, e o efeito era o que o
 * briefing pede para não existir: um menu em que se procura em vez de navegar.
 * Agora cada assunto tem um dono, e o que era item de primeiro nível virou
 * subitem do módulo a que pertence.
 *
 * Os subitens só aparecem quando o módulo está aberto. É o que mantém as duas
 * exigências ao mesmo tempo — poucos menus à vista, e nenhum clique a mais para
 * chegar onde já se sabe que se quer ir, porque o módulo leva direto à tela
 * principal dele.
 */

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  modulo: Modulo;
}

export interface ModuloNavegacao {
  /** Chave estável, usada no ícone e no destaque do módulo ativo. */
  chave: string;
  rotulo: string;
  icone: string;
  /** Para onde o clique no módulo leva: a tela principal dele. */
  href: string;
  /**
   * Módulo de permissão que libera o item de menu. É o do `href`: quem não
   * pode ver a tela principal não vê o módulo.
   */
  modulo: Modulo;
  itens: readonly ItemNavegacao[];
}

export const MODULOS_NAVEGACAO: readonly ModuloNavegacao[] = [
  {
    chave: "dashboard",
    rotulo: "Dashboard",
    icone: "dashboard",
    href: "/",
    modulo: "dashboard",
    itens: [],
  },
  {
    chave: "comercial",
    rotulo: "Comercial",
    icone: "vendedores",
    href: "/vendedores",
    modulo: "vendedores",
    itens: [
      { href: "/vendedores", rotulo: "Pessoas", modulo: "vendedores" },
      { href: "/pendencias", rotulo: "Pendências de cadastro", modulo: "vendedores" },
      { href: "/vinculos", rotulo: "Vínculos de documentos", modulo: "vendedores" },
      { href: "/equipes", rotulo: "Equipes", modulo: "equipes" },
      { href: "/gerencias", rotulo: "Gerências", modulo: "gerencias" },
    ],
  },
  {
    chave: "carteira",
    rotulo: "Carteira",
    icone: "cotas",
    href: "/clientes",
    modulo: "cotas",
    itens: [{ href: "/clientes", rotulo: "Cotas", modulo: "cotas" }],
  },
  {
    chave: "financeiro",
    rotulo: "Financeiro",
    icone: "comissoesEquipe",
    href: "/comissoes-equipe",
    modulo: "comissoesEquipe",
    itens: [
      { href: "/comissoes-equipe", rotulo: "A pagar", modulo: "comissoesEquipe" },
      { href: "/estornos", rotulo: "Estornos", modulo: "comissoesEquipe" },
      { href: "/bonus", rotulo: "Bônus de incentivo", modulo: "comissoes" },
      // Fechamento da administradora. Mostra o que a WR RECEBE, que o briefing
      // manda não exibir — fica restrito ao perfil financeiro e é o candidato
      // número um a virar tela só de conciliação. Ver docs/ARQUITETURA.md §6.
      { href: "/comissoes", rotulo: "Fechamento da administradora", modulo: "comissoes" },
    ],
  },
  {
    chave: "importacoes",
    rotulo: "Importações",
    icone: "importacoes",
    href: "/importacoes",
    modulo: "importacoes",
    itens: [{ href: "/importacoes", rotulo: "Arquivos e histórico", modulo: "importacoes" }],
  },
  {
    chave: "atendimento",
    rotulo: "Atendimento",
    icone: "atendimento",
    href: "/atendimento",
    modulo: "atendimento",
    itens: [
      { href: "/atendimento", rotulo: "Visão geral", modulo: "atendimento" },
      { href: "/atendimento/conversas", rotulo: "Conversas", modulo: "conversas" },
      { href: "/atendimento/clientes", rotulo: "Clientes", modulo: "clientesBot" },
      { href: "/atendimento/pedidos", rotulo: "Pedidos", modulo: "pedidos" },
      { href: "/atendimento/planos", rotulo: "Planos", modulo: "planos" },
      { href: "/atendimento/aparelhos", rotulo: "Aparelhos", modulo: "aparelhos" },
      { href: "/atendimento/fluxos", rotulo: "Fluxos", modulo: "fluxos" },
      { href: "/atendimento/mensagens", rotulo: "Mensagens", modulo: "mensagensBot" },
      { href: "/atendimento/configuracoes", rotulo: "Configurações", modulo: "configAtendimento" },
      { href: "/atendimento/logs", rotulo: "Logs", modulo: "logsAtendimento" },
      { href: "/atendimento/saude", rotulo: "Saúde do sistema", modulo: "atendimento" },
    ],
  },
  {
    chave: "administracao",
    rotulo: "Administração",
    icone: "configuracoes",
    href: "/configuracoes",
    modulo: "tabelas",
    itens: [
      { href: "/configuracoes", rotulo: "Regras e percentuais", modulo: "tabelas" },
      { href: "/usuarios", rotulo: "Usuários", modulo: "usuarios" },
      { href: "/auditoria", rotulo: "Auditoria", modulo: "auditoria" },
      { href: "/backups", rotulo: "Backups", modulo: "backups" },
    ],
  },
];

/**
 * Módulos visíveis para o perfil, já com os subitens filtrados.
 *
 * Um módulo some quando o perfil não pode ver nenhum item dele — não adianta
 * mostrar "Administração" para quem não tem nada dentro.
 */
export function modulosPara(permitidos: readonly string[]): ModuloNavegacao[] {
  return MODULOS_NAVEGACAO.map((modulo) => ({
    ...modulo,
    itens: modulo.itens.filter((item) => permitidos.includes(item.modulo)),
  })).filter(
    (modulo) =>
      permitidos.includes(modulo.modulo) ||
      modulo.itens.length > 0,
  );
}

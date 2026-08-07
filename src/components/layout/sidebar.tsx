"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Building2,
  ClipboardList,
  Database,
  Gift,
  HandCoins,
  HardDriveDownload,
  LayoutDashboard,
  Menu,
  Percent,
  TriangleAlert,
  Link2,
  ScrollText,
  SlidersHorizontal,
  Upload,
  UserCog,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Botao } from "@/components/ui";
import { modulosPara, type ModuloNavegacao } from "./navegacao";

const ICONES = {
  dashboard: LayoutDashboard,
  comissoes: BadgeDollarSign,
  comissoesEquipe: HandCoins,
  bonus: Gift,
  cotas: Database,
  importacoes: Upload,
  vendedores: Users,
  pendencias: TriangleAlert,
  vinculos: Link2,
  equipes: UsersRound,
  gerencias: Building2,
  tabelas: Percent,
  configuracoes: SlidersHorizontal,
  usuarios: UserCog,
  auditoria: ScrollText,
  backups: HardDriveDownload,
} as const;

function estaAtivo(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Itens({
  modulos,
  aoNavegar,
}: {
  modulos: ModuloNavegacao[];
  aoNavegar?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {modulos.map((modulo) => {
        const Icone = ICONES[modulo.icone as keyof typeof ICONES] ?? ClipboardList;

        // O módulo fica aberto quando a rota atual é dele. Abrir por clique
        // exigiria um clique a mais para chegar onde o usuário já sabe que
        // quer ir; abrir tudo devolveria o menu de quinze itens.
        const dentroDoModulo =
          estaAtivo(pathname, modulo.href) ||
          modulo.itens.some((item) => estaAtivo(pathname, item.href));

        return (
          <div key={modulo.chave}>
            <Link
              href={modulo.href}
              onClick={aoNavegar}
              aria-current={estaAtivo(pathname, modulo.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                dentroDoModulo
                  ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                  : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
              )}
            >
              <Icone className="h-4 w-4 shrink-0" />
              {modulo.rotulo}
            </Link>

            {dentroDoModulo && modulo.itens.length > 1 ? (
              <ul className="mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[var(--color-borda)] pl-3 ml-5">
                {modulo.itens.map((item) => {
                  const ativo = estaAtivo(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={aoNavegar}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                          ativo
                            ? "font-medium text-[var(--color-marca-forte)]"
                            : "text-[var(--color-texto-3)] hover:bg-[var(--color-superficie-3)] hover:text-[var(--color-texto-2)]",
                        )}
                      >
                        {item.rotulo}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ modulos }: { modulos: string[] }) {
  const [aberto, setAberto] = useState(false);
  const navegacao = modulosPara(modulos);

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-[var(--color-borda)] bg-[var(--color-superficie-2)] lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--color-borda)] px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-marca)] text-sm font-bold text-white">
            WR
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">WR Consórcio</p>
            <p className="text-xs text-[var(--color-texto-3)]">ERP Comercial</p>
          </div>
        </div>
        <div className="overflow-y-auto p-3" style={{ maxHeight: "calc(100dvh - 4rem)" }}>
          <Itens modulos={navegacao} />
        </div>
      </aside>

      <Botao
        variante="secundario"
        tamanho="icone"
        type="button"
        className="lg:hidden"
        aria-label="Abrir menu"
        onClick={() => setAberto(true)}
      >
        <Menu className="h-4 w-4" />
      </Botao>

      {aberto ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setAberto(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-[var(--color-superficie-2)] p-3">
            <div className="mb-4 flex items-center justify-between px-2">
              <p className="text-sm font-semibold">WR Consórcio</p>
              <Botao
                variante="sutil"
                tamanho="icone"
                type="button"
                aria-label="Fechar menu"
                onClick={() => setAberto(false)}
              >
                <X className="h-4 w-4" />
              </Botao>
            </div>
            <Itens modulos={navegacao} aoNavegar={() => setAberto(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

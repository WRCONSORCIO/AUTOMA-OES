"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Building2,
  ClipboardList,
  Database,
  HardDriveDownload,
  LayoutDashboard,
  Menu,
  Percent,
  TriangleAlert,
  ScrollText,
  Upload,
  UserCog,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Botao } from "@/components/ui";
import { GRUPOS, NAVEGACAO, type ItemNavegacao } from "./navegacao";

const ICONES = {
  dashboard: LayoutDashboard,
  comissoes: BadgeDollarSign,
  cotas: Database,
  importacoes: Upload,
  vendedores: Users,
  pendencias: TriangleAlert,
  equipes: UsersRound,
  gerencias: Building2,
  tabelas: Percent,
  usuarios: UserCog,
  auditoria: ScrollText,
  backups: HardDriveDownload,
} as const;

function estaAtivo(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Itens({ itens, aoNavegar }: { itens: ItemNavegacao[]; aoNavegar?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {GRUPOS.map((grupo) => {
        const doGrupo = itens.filter((item) => item.grupo === grupo);
        if (doGrupo.length === 0) return null;

        return (
          <div key={grupo}>
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-[var(--color-texto-3)]">
              {grupo}
            </p>
            <ul className="flex flex-col gap-0.5">
              {doGrupo.map((item) => {
                const Icone = ICONES[item.icone as keyof typeof ICONES] ?? ClipboardList;
                const ativo = estaAtivo(pathname, item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={aoNavegar}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        ativo
                          ? "bg-[var(--color-marca-suave)] font-medium text-[var(--color-marca-forte)]"
                          : "text-[var(--color-texto-2)] hover:bg-[var(--color-superficie-3)]",
                      )}
                    >
                      <Icone className="h-4 w-4 shrink-0" />
                      {item.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ modulos }: { modulos: string[] }) {
  const [aberto, setAberto] = useState(false);
  const itens = NAVEGACAO.filter((item) => modulos.includes(item.modulo));

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
          <Itens itens={itens} />
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
            <Itens itens={itens} aoNavegar={() => setAberto(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

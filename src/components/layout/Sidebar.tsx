import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  CreditCard,
  Users,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/cartas", label: "Cartas", icon: CreditCard, end: false },
  { to: "/vendedores", label: "Vendedores", icon: Users, end: false },
  { to: "/financeiro", label: "Financeiro", icon: Wallet, end: false },
]

export function Sidebar() {
  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border">
      <div className="px-5 py-5 text-sm font-semibold tracking-wide text-sidebar-foreground/70">
        WR Consórcio
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

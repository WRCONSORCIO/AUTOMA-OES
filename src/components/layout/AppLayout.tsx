import { Outlet } from "react-router-dom"

import { Sidebar } from "./Sidebar"

export function AppLayout() {
  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

import { Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { CartasPage } from '@/pages/CartasPage'
import { VendedoresPage } from '@/pages/VendedoresPage'
import { FinanceiroPage } from '@/pages/FinanceiroPage'
import { SetupNoticePage } from '@/pages/SetupNoticePage'
import { isSupabaseConfigured } from '@/lib/supabase'

function App() {
  if (!isSupabaseConfigured) {
    return <SetupNoticePage />
  }

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="cartas" element={<CartasPage />} />
          <Route path="vendedores" element={<VendedoresPage />} />
          <Route path="financeiro" element={<FinanceiroPage />} />
        </Route>
      </Routes>
      <Toaster position="top-right" richColors />
    </>
  )
}

export default App

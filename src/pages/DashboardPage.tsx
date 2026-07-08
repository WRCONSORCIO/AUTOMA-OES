import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatDate } from "@/lib/format"
import { useCartas } from "@/hooks/useCartas"
import { Badge } from "@/components/ui/badge"

const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
]

export function DashboardPage() {
  const { data: cartas, isLoading } = useCartas()

  const stats = useMemo(() => {
    const lista = cartas ?? []
    const emEstoque = lista.filter((c) => c.status === "estoque")
    const vendidas = lista.filter((c) => c.status === "vendida")
    const intermediacoes = lista.filter((c) => c.tipo_negociacao === "intermediacao")
    const lucroTotal = vendidas.reduce((acc, c) => acc + (c.lucro ?? 0), 0)
    const valorEmEstoque = emEstoque.reduce((acc, c) => acc + c.valor_compra, 0)

    return {
      totalCompradas: lista.length,
      emEstoqueQtd: emEstoque.length,
      valorEmEstoque,
      vendidasQtd: vendidas.length,
      intermediacoesQtd: intermediacoes.length,
      lucroTotal,
    }
  }, [cartas])

  const lucroPorMes = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const carta of cartas ?? []) {
      if (carta.status !== "vendida" || !carta.data_venda) continue
      const key = carta.data_venda.slice(0, 7)
      porMes.set(key, (porMes.get(key) ?? 0) + (carta.lucro ?? 0))
    }
    return Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, lucro]) => {
        const mesIdx = Number(key.slice(5, 7)) - 1
        return { mes: MESES_ABREV[mesIdx], lucro }
      })
  }, [cartas])

  const ultimasCartas = (cartas ?? []).slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral das cartas contempladas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardContent>
            <CardTitle>Compradas</CardTitle>
            <p className="mt-1 text-2xl font-semibold">{stats.totalCompradas}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Em estoque</CardTitle>
            <p className="mt-1 text-2xl font-semibold">{stats.emEstoqueQtd}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(stats.valorEmEstoque)} investidos
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Vendidas</CardTitle>
            <p className="mt-1 text-2xl font-semibold">{stats.vendidasQtd}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Intermediação</CardTitle>
            <p className="mt-1 text-2xl font-semibold">{stats.intermediacoesQtd}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Lucro total</CardTitle>
            <p
              className={
                "mt-1 text-2xl font-semibold " +
                (stats.lucroTotal >= 0 ? "text-success" : "text-destructive")
              }
            >
              {formatCurrency(stats.lucroTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent>
            <CardTitle>Lucro por mês (últimos 6 meses com venda)</CardTitle>
            <div className="mt-4 h-64">
              {lucroPorMes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem vendas registradas ainda.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lucroPorMes}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatCurrency(Number(v))}
                      width={90}
                    />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Bar dataKey="lucro" fill="var(--color-success)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <CardTitle>Últimas cartas cadastradas</CardTitle>
            <div className="mt-4 flex flex-col gap-3">
              {isLoading && (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              )}
              {!isLoading && ultimasCartas.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma carta cadastrada ainda.
                </p>
              )}
              {ultimasCartas.map((carta) => (
                <div
                  key={carta.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {carta.codigo} · {carta.administradora}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {carta.cliente_vendedor_nome} · {formatDate(carta.data_compra)}
                    </p>
                  </div>
                  <Badge variant={carta.status === "vendida" ? "success" : "secondary"}>
                    {carta.status === "vendida" ? "Vendida" : "Estoque"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

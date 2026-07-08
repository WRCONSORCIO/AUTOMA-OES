import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/format"
import { useCartas } from "@/hooks/useCartas"
import type { CartaComVendedor } from "@/types/database"

type TipoTransacao = "Compra" | "Venda" | "Intermediação"

interface Transacao {
  id: string
  data: string
  tipo: TipoTransacao
  descricao: string
  vendedor: string
  entrada: number
  saida: number
  resultado: number
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

function toTransacoes(cartas: CartaComVendedor[]): Transacao[] {
  const rows: Transacao[] = []

  for (const carta of cartas) {
    rows.push({
      id: `${carta.id}-compra`,
      data: carta.data_compra,
      tipo: "Compra",
      descricao: `Compra de ${carta.cliente_vendedor_nome} — ${carta.administradora}`,
      vendedor: carta.vendedor?.nome ?? "—",
      entrada: 0,
      saida: carta.valor_compra,
      resultado: -carta.valor_compra,
    })

    if (carta.status === "vendida" && carta.data_venda) {
      const intermediacao = carta.tipo_negociacao === "intermediacao"
      rows.push({
        id: `${carta.id}-venda`,
        data: carta.data_venda,
        tipo: intermediacao ? "Intermediação" : "Venda",
        descricao: intermediacao
          ? `Intermediação ${carta.cliente_vendedor_nome} — ${carta.administradora}`
          : `Venda para ${carta.cliente_comprador_nome} — ${carta.codigo}`,
        vendedor: carta.vendedor?.nome ?? "—",
        entrada: carta.valor_venda ?? 0,
        saida: carta.comissao_vendedor,
        resultado: carta.lucro ?? 0,
      })
    }
  }

  return rows.sort((a, b) => (a.data < b.data ? 1 : -1))
}

const TIPO_BADGE_VARIANT: Record<TipoTransacao, "secondary" | "success" | "outline"> = {
  Compra: "secondary",
  Venda: "success",
  Intermediação: "outline",
}

export function FinanceiroPage() {
  const { data: cartas, isLoading } = useCartas()

  const [busca, setBusca] = useState("")
  const [tipo, setTipo] = useState<"todos" | TipoTransacao>("todos")
  const [mes, setMes] = useState("todos")
  const [ano, setAno] = useState("todos")

  const todasTransacoes = useMemo(() => toTransacoes(cartas ?? []), [cartas])

  const anosDisponiveis = useMemo(() => {
    const set = new Set(todasTransacoes.map((t) => t.data.slice(0, 4)))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [todasTransacoes])

  const filtradas = useMemo(() => {
    return todasTransacoes.filter((t) => {
      if (tipo !== "todos" && t.tipo !== tipo) return false
      if (ano !== "todos" && t.data.slice(0, 4) !== ano) return false
      if (mes !== "todos" && t.data.slice(5, 7) !== mes) return false
      if (busca.trim() && !t.descricao.toLowerCase().includes(busca.trim().toLowerCase()))
        return false
      return true
    })
  }, [todasTransacoes, tipo, ano, mes, busca])

  const totais = filtradas.reduce(
    (acc, t) => {
      acc.entradas += t.entrada
      acc.saidas += t.saida
      acc.resultado += t.resultado
      return acc
    },
    { entradas: 0, saidas: 0, resultado: 0 }
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Financeiro</h1>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Buscar..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-48"
          />
          <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="Compra">Compra</SelectItem>
              <SelectItem value="Venda">Venda</SelectItem>
              <SelectItem value="Intermediação">Intermediação</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Todos os meses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {MESES.map((nome, i) => (
                <SelectItem key={nome} value={String(i + 1).padStart(2, "0")}>
                  {nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ano} onValueChange={setAno}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {anosDisponiveis.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between">
            <div>
              <CardTitle>Entradas</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-success">
                {formatCurrency(totais.entradas)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between">
            <div>
              <CardTitle>Saídas</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-destructive">
                {formatCurrency(totais.saidas)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between">
            <div>
              <CardTitle>Resultado</CardTitle>
              <p
                className={
                  "mt-1 text-2xl font-semibold " +
                  (totais.resultado >= 0 ? "text-success" : "text-destructive")
                }
              >
                {formatCurrency(totais.resultado)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right">Entrada</TableHead>
              <TableHead className="text-right">Saída</TableHead>
              <TableHead className="text-right">Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhuma transação encontrada.
                </TableCell>
              </TableRow>
            )}
            {filtradas.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{formatDate(t.data)}</TableCell>
                <TableCell>
                  <Badge variant={TIPO_BADGE_VARIANT[t.tipo]}>{t.tipo}</Badge>
                </TableCell>
                <TableCell>{t.descricao}</TableCell>
                <TableCell>{t.vendedor}</TableCell>
                <TableCell className="text-right text-success">
                  {t.entrada ? formatCurrency(t.entrada) : "—"}
                </TableCell>
                <TableCell className="text-right text-destructive">
                  {t.saida ? formatCurrency(t.saida) : "—"}
                </TableCell>
                <TableCell
                  className={
                    "text-right font-medium " +
                    (t.resultado >= 0 ? "text-success" : "text-destructive")
                  }
                >
                  {formatCurrency(t.resultado)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {filtradas.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>Totais</TableCell>
                <TableCell className="text-right text-success">
                  {formatCurrency(totais.entradas)}
                </TableCell>
                <TableCell className="text-right text-destructive">
                  {formatCurrency(totais.saidas)}
                </TableCell>
                <TableCell
                  className={
                    "text-right " +
                    (totais.resultado >= 0 ? "text-success" : "text-destructive")
                  }
                >
                  {formatCurrency(totais.resultado)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {filtradas.length} transação(ões) encontrada(s)
      </p>
    </div>
  )
}

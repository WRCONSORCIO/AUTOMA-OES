import { useMemo, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/format"
import { useCartas, useCreateCarta, useDeleteCarta, useUpdateCarta } from "@/hooks/useCartas"
import { useVendedores } from "@/hooks/useVendedores"
import type { CartaComVendedor, CartaInput } from "@/types/database"
import { CartaFormDialog } from "@/pages/cartas/CartaFormDialog"

type FiltroAba = "todas" | "estoque" | "vendida" | "intermediacao"

export function CartasPage() {
  const { data: cartas, isLoading } = useCartas()
  const { data: vendedores } = useVendedores()
  const createCarta = useCreateCarta()
  const updateCarta = useUpdateCarta()
  const deleteCarta = useDeleteCarta()

  const [aba, setAba] = useState<FiltroAba>("todas")
  const [busca, setBusca] = useState("")
  const [administradoraFiltro, setAdministradoraFiltro] = useState("todas")

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CartaComVendedor | null>(null)

  const administradoras = useMemo(() => {
    const set = new Set((cartas ?? []).map((c) => c.administradora))
    return Array.from(set).sort()
  }, [cartas])

  const filtradas = useMemo(() => {
    return (cartas ?? []).filter((carta) => {
      if (aba === "estoque" && carta.status !== "estoque") return false
      if (aba === "vendida" && carta.status !== "vendida") return false
      if (aba === "intermediacao" && carta.tipo_negociacao !== "intermediacao")
        return false

      if (administradoraFiltro !== "todas" && carta.administradora !== administradoraFiltro)
        return false

      if (busca.trim()) {
        const termo = busca.trim().toLowerCase()
        const alvo = [
          carta.codigo,
          carta.administradora,
          carta.cliente_vendedor_nome,
          carta.cliente_vendedor_documento,
          carta.cliente_comprador_nome,
          carta.cliente_comprador_documento,
          carta.vendedor?.nome,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!alvo.includes(termo)) return false
      }

      return true
    })
  }, [cartas, aba, administradoraFiltro, busca])

  function openCreate() {
    setEditing(null)
    setOpen(true)
  }

  function openEdit(carta: CartaComVendedor) {
    setEditing(carta)
    setOpen(true)
  }

  async function handleSubmit(input: CartaInput) {
    try {
      if (editing) {
        await updateCarta.mutateAsync({ id: editing.id, input })
        toast.success("Carta atualizada.")
      } else {
        await createCarta.mutateAsync(input)
        toast.success("Carta cadastrada.")
      }
      setOpen(false)
    } catch (err) {
      toast.error("Não foi possível salvar a carta.")
      console.error(err)
    }
  }

  async function handleDelete(carta: CartaComVendedor) {
    if (!confirm(`Excluir a carta ${carta.codigo}?`)) return
    try {
      await deleteCarta.mutateAsync(carta.id)
      toast.success("Carta excluída.")
    } catch (err) {
      toast.error("Não foi possível excluir a carta.")
      console.error(err)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cartas</h1>
          <p className="text-sm text-muted-foreground">
            Compra, venda e intermediação de cartas contempladas.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Nova carta
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={aba} onValueChange={(v) => setAba(v as FiltroAba)}>
          <TabsList>
            <TabsTrigger value="todas">Todas</TabsTrigger>
            <TabsTrigger value="estoque">Estoque</TabsTrigger>
            <TabsTrigger value="vendida">Vendidas</TabsTrigger>
            <TabsTrigger value="intermediacao">Intermediação</TabsTrigger>
          </TabsList>
        </Tabs>

        <Input
          placeholder="Buscar por cliente, código, documento..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
        />

        <Select value={administradoraFiltro} onValueChange={setAdministradoraFiltro}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Administradora" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas administradoras</SelectItem>
            {administradoras.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Administradora</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cliente (dono)</TableHead>
              <TableHead>Comprador</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right">Valor carta</TableHead>
              <TableHead className="text-right">Compra</TableHead>
              <TableHead className="text-right">Venda</TableHead>
              <TableHead className="text-right">Lucro</TableHead>
              <TableHead>Data compra</TableHead>
              <TableHead>Data venda</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground">
                  Nenhuma carta encontrada.
                </TableCell>
              </TableRow>
            )}
            {filtradas.map((carta) => (
              <TableRow key={carta.id}>
                <TableCell className="font-medium">{carta.codigo}</TableCell>
                <TableCell>{carta.administradora}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={carta.status === "vendida" ? "success" : "secondary"}>
                      {carta.status === "vendida" ? "Vendida" : "Estoque"}
                    </Badge>
                    {carta.tipo_negociacao === "intermediacao" && (
                      <Badge variant="outline">Intermediação</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{carta.cliente_vendedor_nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {carta.cliente_vendedor_documento}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {carta.cliente_comprador_nome ? (
                    <div className="flex flex-col">
                      <span>{carta.cliente_comprador_nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {carta.cliente_comprador_documento}
                      </span>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{carta.vendedor?.nome ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(carta.valor_carta)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(carta.valor_compra)}
                </TableCell>
                <TableCell className="text-right">
                  {carta.valor_venda != null ? formatCurrency(carta.valor_venda) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {carta.lucro != null ? (
                    <span
                      className={
                        carta.lucro >= 0 ? "text-success font-medium" : "text-destructive font-medium"
                      }
                    >
                      {formatCurrency(carta.lucro)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{formatDate(carta.data_compra)}</TableCell>
                <TableCell>{formatDate(carta.data_venda)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(carta)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(carta)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CartaFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        vendedores={vendedores ?? []}
        onSubmit={handleSubmit}
        isSubmitting={createCarta.isPending || updateCarta.isPending}
      />
    </div>
  )
}

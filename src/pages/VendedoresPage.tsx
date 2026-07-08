import { useState, type FormEvent } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useCreateVendedor,
  useDeleteVendedor,
  useUpdateVendedor,
  useVendedores,
} from "@/hooks/useVendedores"
import type { Vendedor, VendedorInput } from "@/types/database"

const EMPTY_FORM: VendedorInput = {
  nome: "",
  telefone: "",
  email: "",
  ativo: true,
}

export function VendedoresPage() {
  const { data: vendedores, isLoading } = useVendedores()
  const createVendedor = useCreateVendedor()
  const updateVendedor = useUpdateVendedor()
  const deleteVendedor = useDeleteVendedor()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vendedor | null>(null)
  const [form, setForm] = useState<VendedorInput>(EMPTY_FORM)

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(vendedor: Vendedor) {
    setEditing(vendedor)
    setForm({
      nome: vendedor.nome,
      telefone: vendedor.telefone,
      email: vendedor.email,
      ativo: vendedor.ativo,
    })
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      if (editing) {
        await updateVendedor.mutateAsync({ id: editing.id, input: form })
        toast.success("Vendedor atualizado.")
      } else {
        await createVendedor.mutateAsync(form)
        toast.success("Vendedor cadastrado.")
      }
      setOpen(false)
    } catch (err) {
      toast.error("Não foi possível salvar o vendedor.")
      console.error(err)
    }
  }

  async function handleDelete(vendedor: Vendedor) {
    if (!confirm(`Excluir o vendedor "${vendedor.nome}"?`)) return
    try {
      await deleteVendedor.mutateAsync(vendedor.id)
      toast.success("Vendedor excluído.")
    } catch (err) {
      toast.error(
        "Não foi possível excluir. Verifique se ele não está vinculado a alguma carta."
      )
      console.error(err)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vendedores</h1>
          <p className="text-sm text-muted-foreground">
            Representantes internos que recebem comissão pelas negociações.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Novo vendedor
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && vendedores?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum vendedor cadastrado ainda.
                </TableCell>
              </TableRow>
            )}
            {vendedores?.map((vendedor) => (
              <TableRow key={vendedor.id}>
                <TableCell className="font-medium">{vendedor.nome}</TableCell>
                <TableCell>{vendedor.telefone || "—"}</TableCell>
                <TableCell>{vendedor.email || "—"}</TableCell>
                <TableCell>
                  <Badge variant={vendedor.ativo ? "success" : "secondary"}>
                    {vendedor.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(vendedor)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(vendedor)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar vendedor" : "Novo vendedor"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                required
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                value={form.telefone ?? ""}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              />
              Ativo
            </label>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createVendedor.isPending || updateVendedor.isPending}
              >
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

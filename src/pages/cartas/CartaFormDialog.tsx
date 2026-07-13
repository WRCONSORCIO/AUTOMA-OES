import { useEffect, useState, type FormEvent } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClienteCombobox } from "@/components/ClienteCombobox"
import { formatCurrency } from "@/lib/format"
import type {
  CartaComRelacoes,
  CartaInput,
  Cliente,
  TipoNegociacao,
  Vendedor,
} from "@/types/database"

interface FormState {
  administradora: string
  tipo_negociacao: TipoNegociacao
  vendedor_id: string
  cliente_vendedor_id: string
  valor_carta: string
  valor_compra: string
  valor_parcela: string
  parcelas_pagas: string
  parcelas_a_pagar: string
  comissao_vendedor: string
  data_compra: string
  observacoes: string
  jaVendida: boolean
  cliente_comprador_id: string
  valor_venda: string
  data_venda: string
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM: FormState = {
  administradora: "",
  tipo_negociacao: "compra_venda",
  vendedor_id: "",
  cliente_vendedor_id: "",
  valor_carta: "",
  valor_compra: "",
  valor_parcela: "",
  parcelas_pagas: "0",
  parcelas_a_pagar: "0",
  comissao_vendedor: "0",
  data_compra: today(),
  observacoes: "",
  jaVendida: false,
  cliente_comprador_id: "",
  valor_venda: "",
  data_venda: today(),
}

function toFormState(carta: CartaComRelacoes): FormState {
  return {
    administradora: carta.administradora,
    tipo_negociacao: carta.tipo_negociacao,
    vendedor_id: carta.vendedor_id ?? "",
    cliente_vendedor_id: carta.cliente_vendedor_id,
    valor_carta: String(carta.valor_carta),
    valor_compra: String(carta.valor_compra),
    valor_parcela: String(carta.valor_parcela),
    parcelas_pagas: String(carta.parcelas_pagas),
    parcelas_a_pagar: String(carta.parcelas_a_pagar),
    comissao_vendedor: String(carta.comissao_vendedor),
    data_compra: carta.data_compra,
    observacoes: carta.observacoes ?? "",
    jaVendida: carta.status === "vendida",
    cliente_comprador_id: carta.cliente_comprador_id ?? "",
    valor_venda: carta.valor_venda != null ? String(carta.valor_venda) : "",
    data_venda: carta.data_venda ?? today(),
  }
}

function num(value: string): number {
  const n = Number(value.replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

interface CartaFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: CartaComRelacoes | null
  vendedores: Vendedor[]
  clientes: Cliente[]
  onSubmit: (input: CartaInput) => Promise<void>
  isSubmitting: boolean
}

export function CartaFormDialog({
  open,
  onOpenChange,
  editing,
  vendedores,
  clientes,
  onSubmit,
  isSubmitting,
}: CartaFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  useEffect(() => {
    if (open) {
      setForm(editing ? toFormState(editing) : EMPTY_FORM)
    }
  }, [open, editing])

  const lucroPreview = form.jaVendida
    ? num(form.valor_venda) - num(form.valor_compra) - num(form.comissao_vendedor)
    : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!form.cliente_vendedor_id) {
      toast.error("Selecione o cliente dono atual da carta.")
      return
    }
    if (form.jaVendida && !form.cliente_comprador_id) {
      toast.error("Selecione o cliente comprador.")
      return
    }

    const input: CartaInput = {
      administradora: form.administradora,
      tipo_negociacao: form.tipo_negociacao,
      status: form.jaVendida ? "vendida" : "estoque",
      vendedor_id: form.vendedor_id || null,
      cliente_vendedor_id: form.cliente_vendedor_id,
      cliente_comprador_id: form.jaVendida ? form.cliente_comprador_id : null,
      valor_carta: num(form.valor_carta),
      valor_compra: num(form.valor_compra),
      valor_venda: form.jaVendida ? num(form.valor_venda) : null,
      valor_parcela: num(form.valor_parcela),
      parcelas_pagas: Math.trunc(num(form.parcelas_pagas)),
      parcelas_a_pagar: Math.trunc(num(form.parcelas_a_pagar)),
      comissao_vendedor: num(form.comissao_vendedor),
      data_compra: form.data_compra,
      data_venda: form.jaVendida ? form.data_venda : null,
      observacoes: form.observacoes || null,
    }

    await onSubmit(input)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Editar ${editing.codigo}` : "Nova carta"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Administradora</Label>
              <Input
                required
                placeholder="Ex: BP Consórcios, TSI..."
                value={form.administradora}
                onChange={(e) => setForm({ ...form, administradora: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de negociação</Label>
              <Select
                value={form.tipo_negociacao}
                onValueChange={(v: TipoNegociacao) =>
                  setForm({ ...form, tipo_negociacao: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compra_venda">Compra e venda</SelectItem>
                  <SelectItem value="intermediacao">Intermediação</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">
              Cliente (dono atual / quem está vendendo a carta)
            </h3>
            <ClienteCombobox
              clientes={clientes}
              value={form.cliente_vendedor_id || null}
              onChange={(id) => setForm({ ...form, cliente_vendedor_id: id })}
              placeholder="Buscar cliente por nome ou CPF/CNPJ..."
            />
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Valores da carta</h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>Valor da carta (R$)</Label>
                <Input
                  required
                  inputMode="decimal"
                  value={form.valor_carta}
                  onChange={(e) => setForm({ ...form, valor_carta: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Valor da parcela (R$)</Label>
                <Input
                  inputMode="decimal"
                  value={form.valor_parcela}
                  onChange={(e) => setForm({ ...form, valor_parcela: e.target.value })}
                />
              </div>
              <div />
              <div className="flex flex-col gap-1.5">
                <Label>Parcelas pagas</Label>
                <Input
                  inputMode="numeric"
                  value={form.parcelas_pagas}
                  onChange={(e) => setForm({ ...form, parcelas_pagas: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Parcelas a pagar</Label>
                <Input
                  inputMode="numeric"
                  value={form.parcelas_a_pagar}
                  onChange={(e) =>
                    setForm({ ...form, parcelas_a_pagar: e.target.value })
                  }
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Compra (o que pagamos)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Valor de compra (R$)</Label>
                <Input
                  required
                  inputMode="decimal"
                  value={form.valor_compra}
                  onChange={(e) => setForm({ ...form, valor_compra: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Data da compra</Label>
                <Input
                  required
                  type="date"
                  value={form.data_compra}
                  onChange={(e) => setForm({ ...form, data_compra: e.target.value })}
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Venda (o que recebemos)</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.jaVendida}
                  onChange={(e) => setForm({ ...form, jaVendida: e.target.checked })}
                />
                Carta já vendida
              </label>
            </div>

            {form.jaVendida && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Comprador</Label>
                  <ClienteCombobox
                    clientes={clientes}
                    value={form.cliente_comprador_id || null}
                    onChange={(id) => setForm({ ...form, cliente_comprador_id: id })}
                    placeholder="Buscar cliente por nome ou CPF/CNPJ..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>Valor de venda (R$)</Label>
                    <Input
                      required={form.jaVendida}
                      inputMode="decimal"
                      value={form.valor_venda}
                      onChange={(e) => setForm({ ...form, valor_venda: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Data da venda</Label>
                    <Input
                      required={form.jaVendida}
                      type="date"
                      value={form.data_venda}
                      onChange={(e) => setForm({ ...form, data_venda: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Vendedor interno e comissão</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Vendedor</Label>
                <Select
                  value={form.vendedor_id || "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, vendedor_id: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {vendedores.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Comissão do vendedor (R$)</Label>
                <Input
                  inputMode="decimal"
                  value={form.comissao_vendedor}
                  onChange={(e) =>
                    setForm({ ...form, comissao_vendedor: e.target.value })
                  }
                />
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-1.5">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            />
          </div>

          {lucroPreview !== null && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <span className="text-sm font-medium">Lucro da negociação</span>
              <span
                className={
                  lucroPreview >= 0
                    ? "text-success font-semibold"
                    : "text-destructive font-semibold"
                }
              >
                {formatCurrency(lucroPreview)}
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

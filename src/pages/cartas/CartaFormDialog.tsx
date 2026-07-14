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
import { CurrencyInput } from "@/components/ui/currency-input"
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
  StatusCarta,
  TipoNegociacao,
  Vendedor,
} from "@/types/database"

interface FormState {
  administradora: string
  tipo_negociacao: TipoNegociacao
  vendedor_id: string
  cliente_vendedor_id: string
  valor_carta: number
  valor_compra: number
  valor_parcela: number
  parcelas_pagas: string
  parcelas_a_pagar: string
  comissao_vendedor: number
  data_compra: string
  observacoes: string
  situacao: StatusCarta
  cliente_comprador_id: string
  valor_venda: number
  data_venda: string
  data_transferencia: string
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM: FormState = {
  administradora: "",
  tipo_negociacao: "compra_venda",
  vendedor_id: "",
  cliente_vendedor_id: "",
  valor_carta: 0,
  valor_compra: 0,
  valor_parcela: 0,
  parcelas_pagas: "0",
  parcelas_a_pagar: "0",
  comissao_vendedor: 0,
  data_compra: today(),
  observacoes: "",
  situacao: "estoque",
  cliente_comprador_id: "",
  valor_venda: 0,
  data_venda: today(),
  data_transferencia: today(),
}

function toFormState(carta: CartaComRelacoes): FormState {
  return {
    administradora: carta.administradora,
    tipo_negociacao: carta.tipo_negociacao,
    vendedor_id: carta.vendedor_id ?? "",
    cliente_vendedor_id: carta.cliente_vendedor_id,
    valor_carta: carta.valor_carta,
    valor_compra: carta.valor_compra,
    valor_parcela: carta.valor_parcela,
    parcelas_pagas: String(carta.parcelas_pagas),
    parcelas_a_pagar: String(carta.parcelas_a_pagar),
    comissao_vendedor: carta.comissao_vendedor,
    data_compra: carta.data_compra,
    observacoes: carta.observacoes ?? "",
    situacao: carta.status,
    cliente_comprador_id: carta.cliente_comprador_id ?? "",
    valor_venda: carta.valor_venda ?? 0,
    data_venda: carta.data_venda ?? today(),
    data_transferencia: carta.data_transferencia ?? today(),
  }
}

function numParcelas(value: string): number {
  const n = Number(value.replace(/\D/g, ""))
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

  const lucroPreview =
    form.situacao === "vendida"
      ? form.valor_venda - form.valor_compra - form.comissao_vendedor
      : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!form.cliente_vendedor_id) {
      toast.error("Selecione o cliente dono atual da carta.")
      return
    }
    if (form.situacao === "vendida" && !form.cliente_comprador_id) {
      toast.error("Selecione o cliente comprador.")
      return
    }
    if (form.situacao === "transferida" && !form.data_transferencia) {
      toast.error("Informe a data da transferência.")
      return
    }

    const input: CartaInput = {
      administradora: form.administradora,
      tipo_negociacao: form.tipo_negociacao,
      status: form.situacao,
      vendedor_id: form.vendedor_id || null,
      cliente_vendedor_id: form.cliente_vendedor_id,
      cliente_comprador_id: form.situacao === "vendida" ? form.cliente_comprador_id : null,
      valor_carta: form.valor_carta,
      valor_compra: form.valor_compra,
      valor_venda: form.situacao === "vendida" ? form.valor_venda : null,
      valor_parcela: form.valor_parcela,
      parcelas_pagas: numParcelas(form.parcelas_pagas),
      parcelas_a_pagar: numParcelas(form.parcelas_a_pagar),
      comissao_vendedor: form.comissao_vendedor,
      data_compra: form.data_compra,
      data_venda: form.situacao === "vendida" ? form.data_venda : null,
      data_transferencia: form.situacao === "transferida" ? form.data_transferencia : null,
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
                <CurrencyInput
                  required
                  value={form.valor_carta}
                  onChange={(v) => setForm({ ...form, valor_carta: v })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Valor da parcela (R$)</Label>
                <CurrencyInput
                  value={form.valor_parcela}
                  onChange={(v) => setForm({ ...form, valor_parcela: v })}
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
                <CurrencyInput
                  required
                  value={form.valor_compra}
                  onChange={(v) => setForm({ ...form, valor_compra: v })}
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
            <h3 className="mb-3 text-sm font-semibold">Situação da carta</h3>
            <Select
              value={form.situacao}
              onValueChange={(v: StatusCarta) => setForm({ ...form, situacao: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="estoque">Em estoque (ainda não vendida)</SelectItem>
                <SelectItem value="vendida">Vendida para um cliente</SelectItem>
                <SelectItem value="transferida">
                  Transferida para o nome da empresa
                </SelectItem>
              </SelectContent>
            </Select>

            {form.situacao === "vendida" && (
              <div className="mt-4 flex flex-col gap-4">
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
                    <CurrencyInput
                      required
                      value={form.valor_venda}
                      onChange={(v) => setForm({ ...form, valor_venda: v })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Data da venda</Label>
                    <Input
                      required
                      type="date"
                      value={form.data_venda}
                      onChange={(e) => setForm({ ...form, data_venda: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}

            {form.situacao === "transferida" && (
              <div className="mt-4 flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  A carta foi comprada, mas em vez de vendida a um cliente, foi
                  transferida para o nome da própria empresa.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>Data da transferência</Label>
                  <Input
                    required
                    type="date"
                    value={form.data_transferencia}
                    onChange={(e) =>
                      setForm({ ...form, data_transferencia: e.target.value })
                    }
                  />
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
                <CurrencyInput
                  value={form.comissao_vendedor}
                  onChange={(v) => setForm({ ...form, comissao_vendedor: v })}
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

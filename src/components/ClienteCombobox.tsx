import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { useCreateCliente } from "@/hooks/useClientes"
import type { Cliente } from "@/types/database"

function detectarTipoPessoa(documento: string): "fisica" | "juridica" {
  return documento.replace(/\D/g, "").length > 11 ? "juridica" : "fisica"
}

interface ClienteComboboxProps {
  clientes: Cliente[]
  value: string | null
  onChange: (clienteId: string) => void
  placeholder?: string
}

export function ClienteCombobox({
  clientes,
  value,
  onChange,
  placeholder,
}: ClienteComboboxProps) {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState("")
  const [criando, setCriando] = useState(false)
  const [novoNome, setNovoNome] = useState("")
  const [novoDocumento, setNovoDocumento] = useState("")
  const createCliente = useCreateCliente()

  const selecionado = clientes.find((c) => c.id === value) ?? null

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return clientes
    const termoDigitos = termo.replace(/\D/g, "")
    return clientes.filter(
      (c) =>
        c.nome.toLowerCase().includes(termo) ||
        (termoDigitos && c.documento.replace(/\D/g, "").includes(termoDigitos))
    )
  }, [clientes, busca])

  function resetCriacao() {
    setCriando(false)
    setNovoNome("")
    setNovoDocumento("")
  }

  async function handleCriar() {
    if (!novoNome.trim() || !novoDocumento.trim()) return
    try {
      const cliente = await createCliente.mutateAsync({
        nome: novoNome.trim(),
        documento: novoDocumento.trim(),
        tipo_pessoa: detectarTipoPessoa(novoDocumento),
        telefone: null,
        email: null,
      })
      onChange(cliente.id)
      setOpen(false)
      resetCriacao()
      setBusca("")
    } catch (err) {
      toast.error(
        "Não foi possível cadastrar. Já pode existir um cliente com esse CPF/CNPJ — busque por ele."
      )
      console.error(err)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetCriacao()
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          {selecionado ? (
            <span className="truncate">
              {selecionado.nome} · {selecionado.documento}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {placeholder ?? "Selecionar cliente..."}
            </span>
          )}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        {criando ? (
          <div className="flex flex-col gap-3 p-3">
            <p className="text-sm font-medium">Novo cliente</p>
            <div className="flex flex-col gap-1.5">
              <Label>Nome</Label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>CPF/CNPJ</Label>
              <Input
                value={novoDocumento}
                onChange={(e) => setNovoDocumento(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resetCriacao}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleCriar}
                disabled={
                  !novoNome.trim() || !novoDocumento.trim() || createCliente.isPending
                }
              >
                Salvar e usar
              </Button>
            </div>
          </div>
        ) : (
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nome ou CPF/CNPJ..."
              value={busca}
              onValueChange={setBusca}
            />
            <CommandList>
              <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
              <CommandGroup>
                {filtrados.map((cliente) => (
                  <CommandItem
                    key={cliente.id}
                    value={cliente.id}
                    onSelect={() => {
                      onChange(cliente.id)
                      setOpen(false)
                      setBusca("")
                    }}
                  >
                    <Check className={cn(cliente.id === value ? "opacity-100" : "opacity-0")} />
                    <span className="flex flex-col">
                      <span>{cliente.nome}</span>
                      <span className="text-xs text-muted-foreground">{cliente.documento}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start gap-2"
                size="sm"
                onClick={() => {
                  setNovoNome(busca)
                  setCriando(true)
                }}
              >
                <UserPlus className="size-4" />
                Cadastrar novo cliente
              </Button>
            </div>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

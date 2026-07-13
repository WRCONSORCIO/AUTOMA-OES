import * as React from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
}

interface CurrencyInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: number
  onChange: (value: number) => void
}

/**
 * Campo de valor em reais que formata sozinho enquanto o usuário digita
 * (estilo app de banco: os dígitos entram da direita para a esquerda,
 * empurrando a vírgula de centavos). O cursor é sempre realinhado ao
 * final do texto — sem isso, o navegador tenta preservar a posição do
 * cursor por índice, e como o texto formatado muda de tamanho a cada
 * tecla, os dígitos entram fora de ordem. O valor sempre fica em number
 * por fora, então não tem como um "R$1.234,56" digitado à mão quebrar
 * uma soma.
 */
export function CurrencyInput({
  value,
  onChange,
  className,
  ...props
}: CurrencyInputProps) {
  const ref = React.useRef<HTMLInputElement>(null)
  const display = formatBRL(value)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement === el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [display])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "")
    const cents = digits === "" ? 0 : parseInt(digits, 10)
    onChange(cents / 100)
  }

  function moveCursorToEnd(e: React.SyntheticEvent<HTMLInputElement>) {
    const target = e.currentTarget
    const end = target.value.length
    target.setSelectionRange(end, end)
  }

  return (
    <Input
      ref={ref}
      inputMode="numeric"
      className={cn("text-right", className)}
      value={display}
      onChange={handleChange}
      onFocus={moveCursorToEnd}
      onClick={moveCursorToEnd}
      {...props}
    />
  )
}

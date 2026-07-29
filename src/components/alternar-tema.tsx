"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Botao } from "@/components/ui";

export function AlternarTema() {
  const { resolvedTheme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  const escuro = resolvedTheme === "dark";

  return (
    <Botao
      variante="secundario"
      tamanho="icone"
      type="button"
      aria-label={escuro ? "Ativar modo claro" : "Ativar modo escuro"}
      onClick={() => setTheme(escuro ? "light" : "dark")}
    >
      {montado && escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Botao>
  );
}

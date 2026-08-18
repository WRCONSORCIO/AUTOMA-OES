"use client";

import type { TipoFluxo } from "@prisma/client";
import { Campo, Entrada, Selecao } from "@/components/ui";
import { FormularioAcao } from "@/components/formulario-acao";
import { acaoCriarFluxo } from "./acoes";

export const ROTULO_TIPO_FLUXO: Record<TipoFluxo, string> = {
  PRINCIPAL: "Principal",
  NOVA_CONTRATACAO: "Nova contratação",
  RENOVACAO: "Renovação",
  APARELHO: "Aparelho",
  AUXILIAR: "Auxiliar",
};

export function NovoFluxo() {
  return (
    <FormularioAcao acao={acaoCriarFluxo} rotuloBotao="Criar fluxo">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Chave" dica="Identificador fixo. Ex.: aparelho_tv_box">
          <Entrada name="chave" required pattern="[a-z0-9_]+" placeholder="aparelho_tv_box" />
        </Campo>
        <Campo rotulo="Nome">
          <Entrada name="nome" required minLength={2} placeholder="Aparelho — TV Box" />
        </Campo>
        <Campo rotulo="Tipo" dica="Principal é a porta de entrada; só um pode estar ativo">
          <Selecao name="tipo" defaultValue="AUXILIAR">
            {Object.entries(ROTULO_TIPO_FLUXO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Descrição">
          <Entrada name="descricao" placeholder="Uso interno" />
        </Campo>
      </div>
    </FormularioAcao>
  );
}

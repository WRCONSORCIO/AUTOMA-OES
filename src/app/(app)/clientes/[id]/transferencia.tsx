"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeftRight, Undo2 } from "lucide-react";
import { Botao, Campo, AreaTexto, Selecao } from "@/components/ui";
import {
  acaoReverterTransferencia,
  acaoTransferirVendedor,
  type EstadoAcao,
} from "./acoes";

function Enviar({ rotulo, icone }: { rotulo: string; icone: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" disabled={pending}>
      {icone}
      {pending ? "Processando…" : rotulo}
    </Botao>
  );
}

function Mensagem({ estado }: { estado: EstadoAcao }) {
  if (!estado.erro && !estado.sucesso) return null;
  const critico = Boolean(estado.erro);

  return (
    <p
      role="status"
      className={
        critico
          ? "rounded-lg bg-[color-mix(in_oklab,var(--color-critico)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-critico)]"
          : "rounded-lg bg-[color-mix(in_oklab,var(--color-bom)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-bom)]"
      }
    >
      {estado.erro ?? estado.sucesso}
    </p>
  );
}

export function FormularioTransferencia({
  cotaId,
  vendedores,
  temOverride,
}: {
  cotaId: string;
  vendedores: { id: string; nome: string }[];
  temOverride: boolean;
}) {
  const [estado, acao] = useActionState<EstadoAcao, FormData>(acaoTransferirVendedor, {});
  const [estadoReversao, acaoReversao] = useActionState<EstadoAcao, FormData>(
    acaoReverterTransferencia,
    {},
  );

  return (
    <div className="flex flex-col gap-5">
      <form action={acao} className="flex flex-col gap-4">
        <input type="hidden" name="cotaId" value={cotaId} />
        <Mensagem estado={estado} />

        <Campo
          rotulo="Novo vendedor"
          dica="A base da administradora não é alterada: é criado um override interno da WR, que passa a ter precedência em todo cálculo."
        >
          <Selecao name="novoVendedorId" required defaultValue="">
            <option value="" disabled>
              Selecione…
            </option>
            {vendedores.map((vendedor) => (
              <option key={vendedor.id} value={vendedor.id}>
                {vendedor.nome}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo rotulo="Motivo">
          <AreaTexto name="motivo" required minLength={3} placeholder="Ex.: venda originada pela equipe X, corrigida conforme apuração interna." />
        </Campo>

        <div>
          <Enviar rotulo="Transferir vendedor" icone={<ArrowLeftRight className="h-4 w-4" />} />
        </div>
      </form>

      {temOverride ? (
        <form
          action={acaoReversao}
          className="flex flex-col gap-3 border-t border-[var(--color-borda)] pt-5"
        >
          <input type="hidden" name="cotaId" value={cotaId} />
          <Mensagem estado={estadoReversao} />
          <Campo
            rotulo="Reverter para o vendedor da administradora"
            dica="O histórico da transferência é mantido integralmente."
          >
            <AreaTexto name="motivo" required minLength={3} placeholder="Motivo da reversão" />
          </Campo>
          <div>
            <Enviar rotulo="Reverter transferência" icone={<Undo2 className="h-4 w-4" />} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Aviso, Botao, Campo, Entrada } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoPromover } from "./promover-acoes";

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Promoção ao próximo degrau.
 *
 * A tela é explícita sobre o que NÃO acontece, porque é o que mais gera medo de
 * clicar: nenhum documento é desativado e nenhuma comissão já apurada muda.
 */
export function Promover({
  pessoaId,
  pessoaNome,
  categoriaAlvo,
  apto,
  faltam,
}: {
  pessoaId: string;
  pessoaNome: string;
  categoriaAlvo: "VETERANO" | "EXPERT";
  apto: boolean;
  faltam: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoPromover, {});

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2">
        {estado.sucesso ? <MensagemAcao estado={estado} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Botao
            type="button"
            variante={apto ? "primario" : "secundario"}
            onClick={() => setAberto(true)}
          >
            Promover a {categoriaAlvo}
          </Botao>
          {!apto ? (
            <span className="text-xs text-[var(--color-texto-3)]">
              A meta ainda não foi atingida. Promover assim é exceção — fica registrado
              na auditoria.
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form action={despachar} className="flex flex-col gap-4">
      <MensagemAcao estado={estado} />
      <input type="hidden" name="pessoaId" value={pessoaId} />
      <input type="hidden" name="categoriaAlvo" value={categoriaAlvo} />

      {!apto ? (
        <Aviso tom="atencao">
          Esta pessoa <strong>ainda não atingiu a meta</strong> — faltam{" "}
          {faltam.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Promover
          agora é uma exceção deliberada, e fica registrada na auditoria com o seu usuário.
        </Aviso>
      ) : null}

      <Aviso tom="marca">
        {categoriaAlvo === "VETERANO" ? (
          <>
            Abre o CNPJ de veterano, por onde <strong>{pessoaNome}</strong> passa a vender. O CPF
            deixa de receber venda nova, mas <strong>continua recebendo</strong> a comissão de
            tudo que já vendeu — nada é desativado.
          </>
        ) : (
          <>
            Abre o CNPJ de expert, que <strong>não vende</strong>: é a identidade pela qual{" "}
            <strong>{pessoaNome}</strong> passa a receber supervisão. O CNPJ de veterano{" "}
            <strong>continua vendendo e recebendo</strong> normalmente.
          </>
        )}{" "}
        As vendas já feitas mantêm a categoria congelada na data em que aconteceram: nenhum
        centavo já apurado muda.
      </Aviso>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="CNPJ do documento" dica="Pode ser um CNPJ novo ou um que a pessoa já tenha: se já existir, ele passa a valer na categoria nova em vez de ser criado.">
          <Entrada name="cpfCnpjNovo" inputMode="numeric" placeholder="00.000.000/0001-00" required />
        </Campo>
        <Campo rotulo="Vale a partir de" dica="Vendas anteriores continuam como estão.">
          <Entrada type="date" name="vigenteDe" defaultValue={hoje()} required />
        </Campo>
        <Campo rotulo="Nome no novo cadastro" dica={`Vazio usa "${pessoaNome}".`}>
          <Entrada name="nomeNovo" placeholder={pessoaNome} />
        </Campo>
        <Campo rotulo="Motivo" dica="Opcional. Fica na auditoria.">
          <Entrada name="motivo" placeholder="Atingiu a meta" />
        </Campo>
      </div>

      <div className="flex gap-2">
        <BotaoAcao>Confirmar promoção</BotaoAcao>
        <Botao type="button" variante="secundario" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

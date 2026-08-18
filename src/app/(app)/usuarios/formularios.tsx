"use client";

import { useActionState, useState } from "react";
import { KeyRound, Power } from "lucide-react";
import { Campo, Entrada, Selecao } from "@/components/ui";
import {
  BotaoAcao,
  FormularioAcao,
  MensagemAcao,
  type EstadoAcao,
} from "@/components/formulario-acao";
import { acaoAlternarUsuario, acaoCriarUsuario, acaoRedefinirSenha } from "./acoes";

type Opcao = { id: string; nome: string };

export function NovoUsuario({
  gerencias,
  equipes,
}: {
  gerencias: Opcao[];
  equipes: Opcao[];
}) {
  const [perfil, setPerfil] = useState("FINANCEIRO");

  return (
    <FormularioAcao acao={acaoCriarUsuario} rotuloBotao="Criar usuário">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Nome">
          <Entrada name="nome" required minLength={3} />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="email" type="email" required />
        </Campo>
        <Campo rotulo="Senha inicial" dica="Mínimo de 8 caracteres.">
          <Entrada name="senha" type="password" required minLength={8} />
        </Campo>
        <Campo rotulo="Perfil">
          <Selecao name="perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            <option value="ADMINISTRADOR">Administrador — acesso total</option>
            <option value="GERENTE">Gerente — apenas a própria gerência</option>
            <option value="SUPERVISOR">Supervisor — apenas a própria equipe</option>
            <option value="FINANCEIRO">Financeiro — módulos financeiros</option>
            <option value="RH">RH — módulos de vendedores</option>
          </Selecao>
        </Campo>

        {perfil === "GERENTE" ? (
          <Campo rotulo="Gerência" dica="Define o escopo de tudo que este usuário enxerga.">
            <Selecao name="gerenciaId" required defaultValue="">
              <option value="" disabled>
                Selecione…
              </option>
              {gerencias.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        ) : null}

        {perfil === "SUPERVISOR" ? (
          <Campo rotulo="Equipe" dica="Define o escopo de tudo que este usuário enxerga.">
            <Selecao name="equipeId" required defaultValue="">
              <option value="" disabled>
                Selecione…
              </option>
              {equipes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        ) : null}
      </div>
    </FormularioAcao>
  );
}

export function AcoesUsuario({ id, ativo }: { id: string; ativo: boolean }) {
  const [estadoAlternar, alternar] = useActionState<EstadoAcao, FormData>(
    acaoAlternarUsuario,
    {},
  );
  const [estadoSenha, redefinir] = useActionState<EstadoAcao, FormData>(acaoRedefinirSenha, {});
  const [abrindoSenha, setAbrindoSenha] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={alternar}>
          <input type="hidden" name="id" value={id} />
          <BotaoAcao variante="secundario">
            <Power className="h-3.5 w-3.5" />
            {ativo ? "Inativar" : "Reativar"}
          </BotaoAcao>
        </form>

        <button
          type="button"
          onClick={() => setAbrindoSenha((atual) => !atual)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Senha
        </button>
      </div>

      <MensagemAcao estado={estadoAlternar} />

      {abrindoSenha ? (
        <form action={redefinir} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <Entrada
            name="senha"
            type="password"
            required
            minLength={8}
            placeholder="Nova senha"
            className="h-8 w-44 text-sm"
          />
          <BotaoAcao>Redefinir</BotaoAcao>
        </form>
      ) : null}

      <MensagemAcao estado={estadoSenha} />
    </div>
  );
}

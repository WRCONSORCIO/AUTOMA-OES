"use client";

import { useActionState, useState } from "react";
import { Link2, Search } from "lucide-react";
import { formatarDocumento, normalizarTexto } from "@/lib/normalize";
import { formatarNumero } from "@/lib/format";
import { Badge, Botao, Campo, Entrada, Selecao } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoSeparar, acaoVincular } from "./acoes";

interface Documento {
  vendedorId: string;
  pessoaId: string;
  nome: string;
  cpfCnpj: string;
  tipo: string;
  categoriaAtual: string;
  equipeNome: string | null;
  gerenciaNome: string | null;
  cotas: number;
}

function Etiqueta({ tipo }: { tipo: string }) {
  return <Badge tom={tipo === "CPF" ? "marca" : "neutro"}>{tipo}</Badge>;
}

/** Sugestão automática: mesmos nomes em pessoas diferentes. */
export function CartaoSugestao({ documentos }: { documentos: Documento[] }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoVincular, {});
  const [selecionados, setSelecionados] = useState<string[]>(
    documentos.map((documento) => documento.vendedorId),
  );

  function alternar(id: string) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id],
    );
  }

  return (
    <form
      action={despachar}
      className="rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
    >
      <p className="mb-3 font-medium">{documentos[0]?.nome}</p>
      <MensagemAcao estado={estado} />

      <div className="mt-3 flex flex-col gap-2">
        {documentos.map((documento) => (
          <label
            key={documento.vendedorId}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-borda)] px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              name="vendedorId"
              value={documento.vendedorId}
              checked={selecionados.includes(documento.vendedorId)}
              onChange={() => alternar(documento.vendedorId)}
              className="h-4 w-4"
            />
            <Etiqueta tipo={documento.tipo} />
            <span className="numerico">{formatarDocumento(documento.cpfCnpj)}</span>
            <Badge tom="neutro">{documento.categoriaAtual}</Badge>
            <span className="text-[var(--color-texto-2)]">
              {documento.gerenciaNome ?? "sem gerência"} · {documento.equipeNome ?? "sem equipe"}
            </span>
            <span className="ml-auto text-[var(--color-texto-3)]">
              {formatarNumero(documento.cotas)} venda(s)
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Campo rotulo="Documento principal" className="w-64">
          <Selecao name="pessoaDestinoId" defaultValue={documentos[0]?.pessoaId ?? ""}>
            {documentos.map((documento) => (
              <option key={documento.pessoaId} value={documento.pessoaId}>
                {documento.tipo} {formatarDocumento(documento.cpfCnpj)}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Motivo" className="min-w-56 flex-1">
          <Entrada name="motivo" defaultValue="Mesmo vendedor, documentos diferentes" />
        </Campo>
        <BotaoAcao>
          <Link2 className="h-4 w-4" />
          Vincular
        </BotaoAcao>
      </div>
    </form>
  );
}

interface Opcao {
  vendedorId: string;
  pessoaId: string;
  nome: string;
  cpfCnpj: string;
  tipo: string;
  documentosNaPessoa: number;
}

/** Vínculo manual, para os CNPJs que vêm com nome diferente do vendedor. */
export function VinculoManual({ vendedores }: { vendedores: Opcao[] }) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoVincular, {});
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const termo = normalizarTexto(busca);
  const filtrados = termo
    ? vendedores.filter(
        (item) =>
          normalizarTexto(item.nome).includes(termo) ||
          item.cpfCnpj.includes(busca.replace(/\D+/g, "")),
      )
    : [];

  const escolhidos = vendedores.filter((item) => selecionados.includes(item.vendedorId));

  function alternar(id: string) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id],
    );
  }

  return (
    <form action={despachar} className="flex flex-col gap-4">
      <MensagemAcao estado={estado} />

      <Campo
        rotulo="Buscar cadastro"
        dica="Procure por nome ou CPF/CNPJ e marque os cadastros que são da mesma pessoa."
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-texto-3)]" />
          <Entrada
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Ex.: ADRIANA, ou 62137904000110"
            className="pl-9"
          />
        </div>
      </Campo>

      {filtrados.length > 0 ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-borda)]">
          {filtrados.slice(0, 40).map((item) => (
            <label
              key={item.vendedorId}
              className="flex flex-wrap items-center gap-3 border-b border-[var(--color-borda)] px-3 py-2 text-sm last:border-0 hover:bg-[var(--color-superficie-3)]"
            >
              <input
                type="checkbox"
                checked={selecionados.includes(item.vendedorId)}
                onChange={() => alternar(item.vendedorId)}
                className="h-4 w-4"
              />
              <Etiqueta tipo={item.tipo} />
              <span className="font-medium">{item.nome}</span>
              <span className="numerico text-[var(--color-texto-2)]">
                {formatarDocumento(item.cpfCnpj)}
              </span>
              {item.documentosNaPessoa > 1 ? (
                <Badge tom="marca">já vinculado a {item.documentosNaPessoa}</Badge>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}

      {escolhidos.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-3)] p-3">
          <p className="mb-2 text-sm font-medium">
            Selecionados ({escolhidos.length})
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {escolhidos.map((item) => (
              <li key={item.vendedorId} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="vendedorId" value={item.vendedorId} />
                <Etiqueta tipo={item.tipo} />
                <span>{item.nome}</span>
                <span className="numerico text-[var(--color-texto-2)]">
                  {formatarDocumento(item.cpfCnpj)}
                </span>
                <button
                  type="button"
                  onClick={() => alternar(item.vendedorId)}
                  className="ml-auto text-xs text-[var(--color-critico)] hover:underline"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Campo rotulo="Documento principal" className="w-64">
              <Selecao name="pessoaDestinoId" defaultValue={escolhidos[0]?.pessoaId ?? ""}>
                {escolhidos.map((item) => (
                  <option key={item.pessoaId} value={item.pessoaId}>
                    {item.tipo} {formatarDocumento(item.cpfCnpj)} · {item.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Motivo" className="min-w-56 flex-1">
              <Entrada
                name="motivo"
                required
                defaultValue="Vínculo manual: CNPJ com nome diferente do vendedor"
              />
            </Campo>
            <BotaoAcao>
              <Link2 className="h-4 w-4" />
              Vincular selecionados
            </BotaoAcao>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-texto-3)]">
          Nenhum cadastro selecionado ainda.
        </p>
      )}
    </form>
  );
}

export function BotaoSeparar({ vendedorId }: { vendedorId: string }) {
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <Botao variante="secundario" tamanho="pequeno" type="button" onClick={() => setAberto(true)}>
        Separar
      </Botao>
    );
  }

  return <FormularioSeparar vendedorId={vendedorId} aoFechar={() => setAberto(false)} />;
}

function FormularioSeparar({
  vendedorId,
  aoFechar,
}: {
  vendedorId: string;
  aoFechar: () => void;
}) {
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoSeparar, {});

  return (
    <form action={despachar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="vendedorId" value={vendedorId} />
      <Entrada
        name="motivo"
        required
        minLength={3}
        placeholder="Motivo da separação"
        className="h-8 w-56 text-sm"
      />
      <BotaoAcao>Confirmar</BotaoAcao>
      <Botao variante="sutil" tamanho="pequeno" type="button" onClick={aoFechar}>
        Cancelar
      </Botao>
      <MensagemAcao estado={estado} />
    </form>
  );
}

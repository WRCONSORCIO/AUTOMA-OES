"use client";

import { useActionState, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/format";
import { formatarDocumento } from "@/lib/normalize";
import { Badge, Botao, Campo, Entrada, Selecao, Td, Tr } from "@/components/ui";
import { BotaoAcao, MensagemAcao, type EstadoAcao } from "@/components/formulario-acao";
import { acaoResolverPendencia } from "./acoes";

interface Pendencia {
  vendedorId: string;
  nome: string;
  cpfCnpj: string;
  criadoPelaImportacao: boolean;
  temHistoricoCategoria: boolean;
  equipeId: string | null;
  gerenciaId: string | null;
  equipeNome: string | null;
  gerenciaNome: string | null;
  cotasSemCategoria: number;
  lancamentosBloqueados: number;
  valorBloqueado: number;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
}

interface Equipe {
  id: string;
  nome: string;
  gerencia: { id: string; nome: string };
}

export function LinhaPendencia({
  pendencia,
  equipes,
  gerencias,
}: {
  pendencia: Pendencia;
  equipes: Equipe[];
  gerencias: { id: string; nome: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, despachar] = useActionState<EstadoAcao, FormData>(acaoResolverPendencia, {});

  // A data da primeira venda é o padrão: cobre todo o histórico já importado.
  const dataPadrao = pendencia.primeiraVenda?.slice(0, 10) ?? "";

  return (
    <>
      <Tr>
        <Td className="font-medium">
          {pendencia.nome}
          <span className="mt-0.5 block text-xs font-normal text-[var(--color-texto-3)]">
            {formatarDocumento(pendencia.cpfCnpj)}
          </span>
        </Td>
        <Td>
          <div className="flex flex-wrap gap-1">
            {pendencia.criadoPelaImportacao ? (
              <Badge tom="atencao">Criado pela importação</Badge>
            ) : null}
            {pendencia.temHistoricoCategoria ? (
              <Badge tom="neutro">Vendas antes da vigência</Badge>
            ) : (
              <Badge tom="critico">Sem categoria</Badge>
            )}
          </div>
        </Td>
        <Td>{pendencia.gerenciaNome ?? <span className="text-[var(--color-texto-3)]">—</span>}</Td>
        <Td>{pendencia.equipeNome ?? <span className="text-[var(--color-texto-3)]">—</span>}</Td>
        <Td className="numerico text-right">{formatarNumero(pendencia.cotasSemCategoria)}</Td>
        <Td className="numerico text-right">{formatarNumero(pendencia.lancamentosBloqueados)}</Td>
        <Td className="numerico text-right font-medium">
          {formatarMoeda(pendencia.valorBloqueado)}
        </Td>
        <Td className="whitespace-nowrap text-xs">
          {formatarData(pendencia.primeiraVenda)} → {formatarData(pendencia.ultimaVenda)}
        </Td>
        <Td>
          <Botao
            variante={aberto ? "sutil" : "secundario"}
            tamanho="pequeno"
            type="button"
            onClick={() => setAberto((atual) => !atual)}
          >
            {aberto ? <X className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {aberto ? "Fechar" : "Resolver"}
          </Botao>
        </Td>
      </Tr>

      {aberto ? (
        <Tr className="hover:bg-transparent">
          <Td colSpan={9} className="bg-[var(--color-superficie-3)]">
            <form action={despachar} className="flex flex-col gap-4">
              <input type="hidden" name="vendedorId" value={pendencia.vendedorId} />
              <MensagemAcao estado={estado} />

              <p className="text-sm text-[var(--color-texto-2)]">
                A categoria vale a partir da data informada. Vendas anteriores a ela continuam sem
                categoria — por isso o padrão é a data da primeira venda deste vendedor.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Campo rotulo="Categoria">
                  <Selecao name="categoria" required defaultValue="">
                    <option value="" disabled>
                      Selecione…
                    </option>
                    <option value="INICIANTE">Iniciante</option>
                    <option value="VETERANO">Veterano</option>
                    <option value="EXPERT">Expert</option>
                  </Selecao>
                </Campo>

                <Campo rotulo="Vigente a partir de">
                  <Entrada type="date" name="vigenteDe" defaultValue={dataPadrao} required />
                </Campo>

                <Campo rotulo="Gerência">
                  <Selecao name="gerenciaId" defaultValue={pendencia.gerenciaId ?? ""}>
                    <option value="">Manter como está</option>
                    {gerencias.map((gerencia) => (
                      <option key={gerencia.id} value={gerencia.id}>
                        {gerencia.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>

                <Campo rotulo="Equipe">
                  <Selecao name="equipeId" defaultValue={pendencia.equipeId ?? ""}>
                    <option value="">Manter como está</option>
                    {equipes.map((equipe) => (
                      <option key={equipe.id} value={equipe.id}>
                        {equipe.nome} · {equipe.gerencia.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>

              <div>
                <BotaoAcao>
                  <Check className="h-4 w-4" />
                  Registrar categoria e recalcular
                </BotaoAcao>
              </div>
            </form>
          </Td>
        </Tr>
      ) : null}
    </>
  );
}

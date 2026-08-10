import { Filter, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Botao, Campo, Entrada, Selecao } from "@/components/ui";
import type { ParametrosBusca } from "@/lib/filtros";

export interface OpcaoFiltro {
  id: string;
  nome: string;
}

export interface ConfiguracaoFiltros {
  administradoras?: OpcaoFiltro[];
  gerencias?: OpcaoFiltro[];
  equipes?: OpcaoFiltro[];
  /**
   * Filtro por DOCUMENTO. Vale onde o documento é o assunto — o relatório da
   * administradora vem por CNPJ, e somar os documentos ali esconderia por qual
   * deles o dinheiro entrou.
   */
  vendedores?: OpcaoFiltro[];
  /**
   * Filtro por PESSOA, somando os documentos dela.
   *
   * É o que a carteira precisa: quem procura as vendas de alguém quer todas,
   * não as de um dos logins. Listar documento fazia a mesma pessoa aparecer
   * duas vezes na lista, e escolher uma das entradas escondia metade das
   * vendas dela sem avisar.
   */
  pessoas?: OpcaoFiltro[];
  situacoes?: OpcaoFiltro[];
  /** Filtro por estorno: qual dos dois tipos, ou nenhum. */
  estornos?: OpcaoFiltro[];
  tipos?: OpcaoFiltro[];
}

/**
 * Filtros em uma única linha acima do conteúdo. Usa navegação por formulário
 * GET, o que mantém o estado na URL e permite compartilhar a visão filtrada.
 */
export function FiltrosPeriodo({
  acao,
  parametros,
  opcoes,
  mostrarBusca = false,
}: {
  acao: string;
  parametros: { de: string; ate: string } & Record<string, string | undefined>;
  opcoes: ConfiguracaoFiltros;
  mostrarBusca?: boolean;
}) {
  return (
    <form
      action={acao}
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-borda)] bg-[var(--color-superficie-2)] p-4"
    >
      <Campo rotulo="De" className="w-[9.5rem]">
        <Entrada type="date" name="de" defaultValue={parametros.de} />
      </Campo>
      <Campo rotulo="Até" className="w-[9.5rem]">
        <Entrada type="date" name="ate" defaultValue={parametros.ate} />
      </Campo>

      {opcoes.administradoras ? (
        <Campo rotulo="Administradora" className="w-48">
          <Selecao name="administradora" defaultValue={parametros.administradora ?? ""}>
            <option value="">Todas</option>
            {opcoes.administradoras.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.gerencias ? (
        <Campo rotulo="Gerência" className="w-44">
          <Selecao name="gerencia" defaultValue={parametros.gerencia ?? ""}>
            <option value="">Todas</option>
            {opcoes.gerencias.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.equipes ? (
        <Campo rotulo="Equipe" className="w-44">
          <Selecao name="equipe" defaultValue={parametros.equipe ?? ""}>
            <option value="">Todas</option>
            {opcoes.equipes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.vendedores ? (
        <Campo rotulo="Vendedor" className="w-52">
          <Selecao name="vendedor" defaultValue={parametros.vendedor ?? ""}>
            <option value="">Todos</option>
            {opcoes.vendedores.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.pessoas ? (
        <Campo rotulo="Vendedor" className="w-52">
          <Selecao name="pessoa" defaultValue={parametros.pessoa ?? ""}>
            <option value="">Todos</option>
            {opcoes.pessoas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.situacoes ? (
        <Campo rotulo="Situação" className="w-44">
          <Selecao name="situacao" defaultValue={parametros.situacao ?? ""}>
            <option value="">Todas</option>
            {opcoes.situacoes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.estornos ? (
        <Campo rotulo="Estorno" className="w-56">
          <Selecao name="estorno" defaultValue={parametros.estorno ?? ""}>
            <option value="">Todas as vendas</option>
            {opcoes.estornos.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {opcoes.tipos ? (
        <Campo rotulo="Tipo" className="w-52">
          <Selecao name="tipo" defaultValue={parametros.tipo ?? ""}>
            <option value="">Todos</option>
            {opcoes.tipos.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : null}

      {mostrarBusca ? (
        <Campo rotulo="Busca" className="min-w-56 flex-1">
          <Entrada
            name="q"
            defaultValue={parametros.q ?? ""}
            placeholder="Cliente, contrato, grupo ou cota"
          />
        </Campo>
      ) : null}

      <div className="flex items-center gap-2">
        <Botao type="submit">
          <Filter className="h-4 w-4" />
          Filtrar
        </Botao>
        <Link
          href={acao}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-borda-forte)] px-3 text-sm hover:bg-[var(--color-superficie-3)]"
        >
          <RotateCcw className="h-4 w-4" />
          Limpar
        </Link>
      </div>
    </form>
  );
}

/** Extrai os parâmetros de filtro já normalizados para os componentes. */
export function lerParametrosFiltro(
  parametros: ParametrosBusca,
  padrao: { de: Date; ate: Date },
): { de: string; ate: string } & Record<string, string | undefined> {
  const primeiro = (chave: string) => {
    const valor = parametros[chave];
    const item = Array.isArray(valor) ? valor[0] : valor;
    return item?.trim() || undefined;
  };

  return {
    de: primeiro("de") ?? padrao.de.toISOString().slice(0, 10),
    ate: primeiro("ate") ?? padrao.ate.toISOString().slice(0, 10),
    administradora: primeiro("administradora"),
    gerencia: primeiro("gerencia"),
    equipe: primeiro("equipe"),
    vendedor: primeiro("vendedor"),
    pessoa: primeiro("pessoa"),
    situacao: primeiro("situacao"),
    estorno: primeiro("estorno"),
    tipo: primeiro("tipo"),
    q: primeiro("q"),
  };
}

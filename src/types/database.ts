export type TipoNegociacao = "compra_venda" | "intermediacao"
export type StatusCarta = "estoque" | "vendida" | "transferida"
export type TipoPessoa = "fisica" | "juridica"

export interface Vendedor {
  id: string
  nome: string
  telefone: string | null
  email: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export type VendedorInput = Pick<Vendedor, "nome" | "telefone" | "email" | "ativo">

export interface Cliente {
  id: string
  nome: string
  documento: string
  tipo_pessoa: TipoPessoa
  telefone: string | null
  email: string | null
  created_at: string
  updated_at: string
}

export type ClienteInput = Pick<
  Cliente,
  "nome" | "documento" | "tipo_pessoa" | "telefone" | "email"
>

export interface Carta {
  id: string
  codigo: string
  administradora: string
  tipo_negociacao: TipoNegociacao
  status: StatusCarta
  vendedor_id: string | null
  cliente_vendedor_id: string
  cliente_comprador_id: string | null
  valor_carta: number
  valor_compra: number
  valor_venda: number | null
  valor_parcela: number
  parcelas_pagas: number
  parcelas_a_pagar: number
  comissao_vendedor: number
  data_compra: string
  data_venda: string | null
  data_transferencia: string | null
  observacoes: string | null
  lucro: number | null
  created_at: string
  updated_at: string
}

export type CartaInput = Omit<
  Carta,
  "id" | "codigo" | "lucro" | "created_at" | "updated_at"
>

type ClienteResumo = Pick<Cliente, "id" | "nome" | "documento" | "tipo_pessoa">

/** Uma carta já com vendedor interno e clientes (vendedor/comprador) carregados (join). */
export interface CartaComRelacoes extends Carta {
  vendedor: Pick<Vendedor, "id" | "nome"> | null
  cliente_vendedor: ClienteResumo | null
  cliente_comprador: ClienteResumo | null
}

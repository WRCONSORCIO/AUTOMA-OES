export type TipoNegociacao = "compra_venda" | "intermediacao"
export type StatusCarta = "estoque" | "vendida"

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

export interface Carta {
  id: string
  codigo: string
  administradora: string
  tipo_negociacao: TipoNegociacao
  status: StatusCarta
  vendedor_id: string | null
  cliente_vendedor_nome: string
  cliente_vendedor_documento: string
  cliente_comprador_nome: string | null
  cliente_comprador_documento: string | null
  valor_carta: number
  valor_compra: number
  valor_venda: number | null
  valor_parcela: number
  parcelas_pagas: number
  parcelas_a_pagar: number
  comissao_vendedor: number
  data_compra: string
  data_venda: string | null
  observacoes: string | null
  lucro: number | null
  created_at: string
  updated_at: string
}

export type CartaInput = Omit<
  Carta,
  "id" | "codigo" | "lucro" | "created_at" | "updated_at"
>

/** Uma carta "com vendedor" já com o relacionamento carregado (join). */
export interface CartaComVendedor extends Carta {
  vendedor: Pick<Vendedor, "id" | "nome"> | null
}

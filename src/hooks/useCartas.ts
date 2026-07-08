import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { supabase } from "@/lib/supabase"
import type { CartaComVendedor, CartaInput } from "@/types/database"

const CARTAS_QUERY_KEY = ["cartas"] as const

export function useCartas() {
  return useQuery({
    queryKey: CARTAS_QUERY_KEY,
    queryFn: async (): Promise<CartaComVendedor[]> => {
      const { data, error } = await supabase
        .from("cartas")
        .select("*, vendedor:vendedores(id, nome)")
        .order("data_compra", { ascending: false })

      if (error) throw error
      return data as unknown as CartaComVendedor[]
    },
  })
}

export function useCreateCarta() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CartaInput) => {
      const { data, error } = await supabase
        .from("cartas")
        .insert(input)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CARTAS_QUERY_KEY })
    },
  })
}

export function useUpdateCarta() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CartaInput }) => {
      const { data, error } = await supabase
        .from("cartas")
        .update(input)
        .eq("id", id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CARTAS_QUERY_KEY })
    },
  })
}

export function useDeleteCarta() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cartas").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CARTAS_QUERY_KEY })
    },
  })
}

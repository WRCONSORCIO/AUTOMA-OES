import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { supabase } from "@/lib/supabase"
import type { Vendedor, VendedorInput } from "@/types/database"

const VENDEDORES_QUERY_KEY = ["vendedores"] as const

export function useVendedores() {
  return useQuery({
    queryKey: VENDEDORES_QUERY_KEY,
    queryFn: async (): Promise<Vendedor[]> => {
      const { data, error } = await supabase
        .from("vendedores")
        .select("*")
        .order("nome", { ascending: true })

      if (error) throw error
      return data
    },
  })
}

export function useCreateVendedor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: VendedorInput) => {
      const { data, error } = await supabase
        .from("vendedores")
        .insert(input)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VENDEDORES_QUERY_KEY })
    },
  })
}

export function useUpdateVendedor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: VendedorInput }) => {
      const { data, error } = await supabase
        .from("vendedores")
        .update(input)
        .eq("id", id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VENDEDORES_QUERY_KEY })
    },
  })
}

export function useDeleteVendedor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vendedores").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VENDEDORES_QUERY_KEY })
    },
  })
}

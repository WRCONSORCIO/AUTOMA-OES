import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { supabase } from "@/lib/supabase"
import type { Cliente, ClienteInput } from "@/types/database"

const CLIENTES_QUERY_KEY = ["clientes"] as const

export function useClientes() {
  return useQuery({
    queryKey: CLIENTES_QUERY_KEY,
    queryFn: async (): Promise<Cliente[]> => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .order("nome", { ascending: true })

      if (error) throw error
      return data
    },
  })
}

export function useCreateCliente() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ClienteInput): Promise<Cliente> => {
      const { data, error } = await supabase
        .from("clientes")
        .insert(input)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTES_QUERY_KEY })
    },
  })
}

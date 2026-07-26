import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { GuardrailsResponse } from '@/types/api'

export function useGuardrails(enabled: boolean = true) {
  return useQuery<GuardrailsResponse>({
    queryKey: ['guardrails'],
    queryFn: () => apiGet<GuardrailsResponse>('/api/dashboard/guardrails'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

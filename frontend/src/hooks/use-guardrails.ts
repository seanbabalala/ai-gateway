import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { GuardrailsResponse } from '@/types/api'

export function useGuardrails() {
  return useQuery<GuardrailsResponse>({
    queryKey: ['guardrails'],
    queryFn: () => apiGet<GuardrailsResponse>('/api/dashboard/guardrails'),
    refetchInterval: 15_000,
  })
}

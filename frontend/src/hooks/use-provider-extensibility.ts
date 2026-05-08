import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ProviderHealthResponse } from '@/types/api'

export function useProviderHealth(period: '1h' | '24h' | '7d' = '24h') {
  return useQuery<ProviderHealthResponse>({
    queryKey: ['provider-health', period],
    queryFn: () =>
      apiGet<ProviderHealthResponse>('/api/dashboard/provider-health', {
        period,
      }),
    refetchInterval: 15_000,
  })
}

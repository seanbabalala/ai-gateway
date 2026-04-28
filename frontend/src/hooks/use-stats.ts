import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { StatsResponse } from '@/types/api'

export function useStats(apiKey?: string) {
  return useQuery<StatsResponse>({
    queryKey: ['stats', apiKey],
    queryFn: () => apiGet<StatsResponse>('/api/dashboard/stats', { api_key: apiKey }),
    refetchInterval: 10_000,
  })
}

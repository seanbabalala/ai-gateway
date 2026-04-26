import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { StatsResponse } from '@/types/api'

export function useStats() {
  return useQuery<StatsResponse>({
    queryKey: ['stats'],
    queryFn: () => apiGet<StatsResponse>('/api/dashboard/stats'),
    refetchInterval: 10_000,
  })
}

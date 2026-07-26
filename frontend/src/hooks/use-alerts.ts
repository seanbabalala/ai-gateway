import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AlertsResponse } from '@/types/api'

export function useAlerts(enabled: boolean = true) {
  return useQuery<AlertsResponse>({
    queryKey: ['alerts'],
    queryFn: () => apiGet<AlertsResponse>('/api/dashboard/alerts'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AlertsResponse } from '@/types/api'

export function useAlerts() {
  return useQuery<AlertsResponse>({
    queryKey: ['alerts'],
    queryFn: () => apiGet<AlertsResponse>('/api/dashboard/alerts'),
    refetchInterval: 15_000,
  })
}

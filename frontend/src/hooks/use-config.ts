import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ConfigResponse } from '@/types/api'

export function useConfig(enabled: boolean = true) {
  return useQuery<ConfigResponse>({
    queryKey: ['config'],
    queryFn: () => apiGet<ConfigResponse>('/api/dashboard/config'),
    enabled,
    staleTime: 60_000,
  })
}

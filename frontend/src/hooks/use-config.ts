import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ConfigResponse } from '@/types/api'

export function useConfig() {
  return useQuery<ConfigResponse>({
    queryKey: ['config'],
    queryFn: () => apiGet<ConfigResponse>('/api/dashboard/config'),
    staleTime: 60_000,
  })
}

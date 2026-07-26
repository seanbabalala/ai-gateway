import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiKeysResponse } from '@/types/api'

export function useApiKeys(enabled: boolean = true) {
  return useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiGet<ApiKeysResponse>('/api/dashboard/api-keys'),
    enabled,
    staleTime: 60_000,
  })
}

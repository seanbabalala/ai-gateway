import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { StatsResponse } from '@/types/api'

export interface ApiKeyFilterScope {
  id?: string
  name?: string
  namespaceId?: string
}

export function useStats(scope?: ApiKeyFilterScope) {
  const key = [
    scope?.id ? `id:${scope.id}` : scope?.name ? `name:${scope.name}` : 'all',
    scope?.namespaceId ? `ns:${scope.namespaceId}` : 'ns:all',
  ].join('|')
  return useQuery<StatsResponse>({
    queryKey: ['stats', key],
    queryFn: () =>
      apiGet<StatsResponse>('/api/dashboard/stats', {
        api_key_id: scope?.id,
        api_key: scope?.id ? undefined : scope?.name,
        namespace: scope?.namespaceId,
      }),
    refetchInterval: 10_000,
  })
}

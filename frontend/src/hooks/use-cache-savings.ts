import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { CacheSavingsResponse } from '@/types/api'
import type { ApiKeyFilterScope } from './use-stats'

export interface CacheSavingsScope extends ApiKeyFilterScope {
  teamId?: string
}

export function useCacheSavings(
  period: string = '7d',
  groupBy: CacheSavingsResponse['group_by'] = 'node',
  scope?: CacheSavingsScope,
) {
  const key = [
    period,
    groupBy,
    scope?.id ? `id:${scope.id}` : scope?.name ? `name:${scope.name}` : 'all',
    scope?.namespaceId ? `ns:${scope.namespaceId}` : 'ns:all',
    scope?.teamId ? `team:${scope.teamId}` : 'team:all',
  ].join('|')

  return useQuery<CacheSavingsResponse>({
    queryKey: ['cache-savings', key],
    queryFn: () =>
      apiGet<CacheSavingsResponse>('/api/dashboard/cache-savings', {
        period,
        group_by: groupBy,
        api_key_id: scope?.id,
        api_key: scope?.id ? undefined : scope?.name,
        namespace: scope?.namespaceId,
        team_id: scope?.teamId,
      }),
    refetchInterval: 30_000,
  })
}

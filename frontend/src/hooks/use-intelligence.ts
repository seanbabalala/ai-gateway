import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { IntelligenceSummaryResponse } from '@/types/api'
import type { ApiKeyFilterScope } from './use-stats'

export function useIntelligenceSummary(
  period: string = '7d',
  scope?: ApiKeyFilterScope,
) {
  const key = [
    period,
    scope?.id ? `id:${scope.id}` : scope?.name ? `name:${scope.name}` : 'all',
    scope?.namespaceId ? `ns:${scope.namespaceId}` : 'ns:all',
  ].join('|')

  return useQuery<IntelligenceSummaryResponse>({
    queryKey: ['intelligence-summary', key],
    queryFn: () =>
      apiGet<IntelligenceSummaryResponse>('/api/dashboard/intelligence/summary', {
        period,
        api_key_id: scope?.id,
        api_key: scope?.id ? undefined : scope?.name,
        namespace: scope?.namespaceId,
      }),
    refetchInterval: 30_000,
  })
}

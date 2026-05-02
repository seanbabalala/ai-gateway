import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { CostAnalyticsResponse } from '@/types/api'
import type { ApiKeyFilterScope } from './use-stats'

export function useCostAnalytics(period: string = '7d', scope?: ApiKeyFilterScope) {
  const key = scope?.id ? `id:${scope.id}` : scope?.name ? `name:${scope.name}` : 'all'
  return useQuery<CostAnalyticsResponse>({
    queryKey: ['analytics', 'cost', period, key],
    queryFn: () =>
      apiGet<CostAnalyticsResponse>('/api/dashboard/analytics/cost', {
        period,
        api_key_id: scope?.id,
        api_key: scope?.id ? undefined : scope?.name,
      }),
    refetchInterval: 30_000,
  })
}

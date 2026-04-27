import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { CostAnalyticsResponse } from '@/types/api'

export function useCostAnalytics(period: string = '7d') {
  return useQuery<CostAnalyticsResponse>({
    queryKey: ['analytics', 'cost', period],
    queryFn: () =>
      apiGet<CostAnalyticsResponse>('/api/dashboard/analytics/cost', { period }),
    refetchInterval: 30_000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { CostAnalyticsResponse } from '@/types/api'

export function useCostAnalytics(period: string = '7d', apiKey?: string) {
  return useQuery<CostAnalyticsResponse>({
    queryKey: ['analytics', 'cost', period, apiKey],
    queryFn: () =>
      apiGet<CostAnalyticsResponse>('/api/dashboard/analytics/cost', { period, api_key: apiKey }),
    refetchInterval: 30_000,
  })
}

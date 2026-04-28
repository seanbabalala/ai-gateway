import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ExperimentAnalyticsResponse } from '@/types/api'

export function useExperimentAnalytics(period: string = '7d', tier?: string) {
  return useQuery<ExperimentAnalyticsResponse>({
    queryKey: ['analytics', 'experiment', period, tier],
    queryFn: () =>
      apiGet<ExperimentAnalyticsResponse>('/api/dashboard/analytics/experiment', {
        period,
        tier,
      }),
    refetchInterval: 30_000,
  })
}

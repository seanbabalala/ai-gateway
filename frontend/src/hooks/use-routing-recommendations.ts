import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AdaptiveRoutingRecommendationsResponse } from '@/types/api'

export function useRoutingRecommendations(windowHours: number = 24, sampleLimit: number = 1000) {
  return useQuery<AdaptiveRoutingRecommendationsResponse>({
    queryKey: ['routing', 'adaptive-recommendations', windowHours, sampleLimit],
    queryFn: () =>
      apiGet<AdaptiveRoutingRecommendationsResponse>('/api/dashboard/routing/recommendations', {
        window_hours: windowHours,
        sample_limit: sampleLimit,
      }),
    refetchInterval: 30_000,
  })
}

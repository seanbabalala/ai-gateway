import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { RouteDecisionSummary, RouteDecisionsResponse } from '@/types/api'

export interface RouteDecisionFilters {
  tier?: string
  node?: string
  source_format?: string
  api_key?: string
  api_key_id?: string
  namespace?: string
}

export function useRouteDecisions(
  page: number,
  limit: number,
  filters: RouteDecisionFilters = {},
) {
  return useQuery<RouteDecisionsResponse>({
    queryKey: ['route-decisions', page, limit, filters],
    queryFn: () =>
      apiGet<RouteDecisionsResponse>('/api/dashboard/route-decisions', {
        page,
        limit,
        tier: filters.tier,
        node: filters.node,
        source_format: filters.source_format,
        api_key_id: filters.api_key_id,
        api_key: filters.api_key,
        namespace: filters.namespace,
      }),
  })
}

export function useRouteDecision(requestId?: string) {
  return useQuery<RouteDecisionSummary>({
    queryKey: ['route-decision', requestId],
    queryFn: () =>
      apiGet<RouteDecisionSummary>(
        `/api/dashboard/route-decisions/${encodeURIComponent(requestId || '')}`,
      ),
    enabled: Boolean(requestId),
    retry: (failureCount, error) => {
      const status = (error as { status?: number })?.status
      if (status === 404) return false
      return failureCount < 2
    },
  })
}

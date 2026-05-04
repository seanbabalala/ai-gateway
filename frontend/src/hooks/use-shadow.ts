import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type {
  ShadowComparisonReport,
  ShadowReportFilters,
  ShadowResultComparison,
  ShadowTrafficResponse,
} from '@/types/api'

export function useShadowTraffic(namespaceId?: string) {
  return useQuery<ShadowTrafficResponse>({
    queryKey: ['shadow-traffic', namespaceId || 'all'],
    queryFn: () =>
      apiGet<ShadowTrafficResponse>('/api/dashboard/shadow', {
        namespace: namespaceId,
      }),
    refetchInterval: 15_000,
  })
}

export function useShadowReport(filters: ShadowReportFilters = {}) {
  return useQuery<ShadowComparisonReport>({
    queryKey: ['shadow-report', filters],
    queryFn: () =>
      apiGet<ShadowComparisonReport>('/api/dashboard/shadow/report', {
        namespace: filters.namespace,
        api_key: filters.api_key,
        api_key_id: filters.api_key_id,
        node: filters.node,
        model: filters.model,
        period: filters.period,
        source_format: filters.source_format,
      }),
    refetchInterval: 30_000,
  })
}

export function useShadowResultComparison(resultId?: number) {
  return useQuery<ShadowResultComparison>({
    queryKey: ['shadow-result-comparison', resultId],
    queryFn: () =>
      apiGet<ShadowResultComparison>(
        `/api/dashboard/shadow/results/${encodeURIComponent(String(resultId))}/comparison`,
      ),
    enabled: typeof resultId === 'number',
  })
}

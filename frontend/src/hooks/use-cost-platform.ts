import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { CostPlatformGroupBy, CostPlatformResponse } from '@/types/api'

export function useCostPlatform(period: string, groupBy: CostPlatformGroupBy) {
  return useQuery<CostPlatformResponse>({
    queryKey: ['cost-platform', period, groupBy],
    queryFn: () =>
      apiGet<CostPlatformResponse>('/api/dashboard/cost-platform', {
        period,
        group_by: groupBy,
      }),
    refetchInterval: 20_000,
  })
}

export function costPlatformExportUrl(period: string, groupBy: CostPlatformGroupBy, format: 'csv' | 'json'): string {
  const params = new URLSearchParams({
    period,
    group_by: groupBy,
    format,
  })
  return `/api/dashboard/cost-platform/export?${params.toString()}`
}

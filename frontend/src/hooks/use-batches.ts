import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BatchDashboardResponse } from '@/types/api'

export interface BatchFilters {
  period?: '24h' | '7d' | '30d' | 'all'
  status?: string
  node?: string
  namespace?: string
  api_key_id?: string
  limit?: number
}

export function useBatches(filters: BatchFilters = {}) {
  return useQuery<BatchDashboardResponse>({
    queryKey: ['batches', filters],
    queryFn: () =>
      apiGet<BatchDashboardResponse>('/api/dashboard/batches', {
        period: filters.period ?? '24h',
        status: filters.status,
        node: filters.node,
        namespace: filters.namespace,
        api_key_id: filters.api_key_id,
        limit: filters.limit,
      }),
    refetchInterval: 15_000,
  })
}

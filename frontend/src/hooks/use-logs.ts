import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { LogsResponse } from '@/types/api'

export interface LogFilters {
  tier?: string
  node?: string
  status?: string
  api_key?: string
}

export function useLogs(page: number, limit: number, filters: LogFilters = {}) {
  return useQuery<LogsResponse>({
    queryKey: ['logs', page, limit, filters],
    queryFn: () =>
      apiGet<LogsResponse>('/api/dashboard/logs', {
        page,
        limit,
        tier: filters.tier,
        node: filters.node,
        status: filters.status,
        api_key: filters.api_key,
      }),
  })
}

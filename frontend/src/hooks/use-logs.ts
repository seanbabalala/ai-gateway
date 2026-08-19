import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { LogsResponse, LogsSummaryResponse } from '@/types/api'

export interface LogFilters {
  tier?: string
  node?: string
  status?: string
  api_key?: string
  api_key_id?: string
  namespace?: string
  period?: string
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
        api_key_id: filters.api_key_id,
        api_key: filters.api_key,
        namespace: filters.namespace,
        period: filters.period,
      }),
  })
}

export function useLogsSummary(filters: LogFilters = {}) {
  return useQuery<LogsSummaryResponse>({
    queryKey: ['logs-summary', filters],
    queryFn: () =>
      apiGet<LogsSummaryResponse>('/api/dashboard/logs/summary', {
        tier: filters.tier,
        node: filters.node,
        status: filters.status,
        api_key_id: filters.api_key_id,
        api_key: filters.api_key,
        namespace: filters.namespace,
        period: filters.period,
      }),
    staleTime: 15_000,
  })
}

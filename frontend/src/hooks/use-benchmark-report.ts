import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BenchmarkReportResponse } from '@/types/api'
import type { ApiKeyFilterScope } from './use-stats'

export interface BenchmarkReportFilters {
  period?: '1h' | '24h' | '7d' | '30d' | '90d'
  node?: string
  model?: string
  source_format?: string
  limit?: number
  scope?: ApiKeyFilterScope
}

export function useBenchmarkReport(filters: BenchmarkReportFilters = {}) {
  const scopeKey = filters.scope?.id
    ? `id:${filters.scope.id}`
    : filters.scope?.name
      ? `name:${filters.scope.name}`
      : 'all'
  const namespaceKey = filters.scope?.namespaceId ? `ns:${filters.scope.namespaceId}` : 'ns:all'

  return useQuery<BenchmarkReportResponse>({
    queryKey: ['benchmark-report', filters, scopeKey, namespaceKey],
    queryFn: () =>
      apiGet<BenchmarkReportResponse>('/api/dashboard/benchmarks/report', {
        period: filters.period ?? '24h',
        node: filters.node,
        model: filters.model,
        source_format: filters.source_format,
        limit: filters.limit,
        api_key_id: filters.scope?.id,
        api_key: filters.scope?.id ? undefined : filters.scope?.name,
        namespace: filters.scope?.namespaceId,
      }),
    refetchInterval: 30_000,
  })
}

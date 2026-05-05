import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { EvalReportDetailResponse, EvalReportsResponse } from '@/types/api'

export interface EvalReportFilters {
  period?: '24h' | '7d' | '30d' | '90d' | 'all'
  status?: string
  dataset_id?: string
  limit?: number
}

export function useEvalReports(filters: EvalReportFilters = {}) {
  return useQuery<EvalReportsResponse>({
    queryKey: ['eval-reports', filters],
    queryFn: () =>
      apiGet<EvalReportsResponse>('/api/dashboard/evals/reports', {
        period: filters.period ?? '30d',
        status: filters.status,
        dataset_id: filters.dataset_id,
        limit: filters.limit,
      }),
    refetchInterval: 30_000,
  })
}

export function useEvalReport(runId?: string) {
  return useQuery<EvalReportDetailResponse>({
    queryKey: ['eval-report', runId],
    queryFn: () => apiGet<EvalReportDetailResponse>(`/api/dashboard/evals/reports/${encodeURIComponent(runId || '')}`),
    enabled: Boolean(runId),
    refetchInterval: 30_000,
  })
}

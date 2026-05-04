import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { SessionDetailResponse, SessionsResponse } from '@/types/api'

export interface SessionFilters {
  period?: string
  namespace?: string
  api_key?: string
  api_key_id?: string
  model?: string
  source_format?: string
}

export function useSessions(
  page: number,
  limit: number,
  filters: SessionFilters = {},
) {
  return useQuery<SessionsResponse>({
    queryKey: ['sessions', page, limit, filters],
    queryFn: () =>
      apiGet<SessionsResponse>('/api/dashboard/sessions', {
        page,
        limit,
        period: filters.period,
        namespace: filters.namespace,
        api_key: filters.api_key,
        api_key_id: filters.api_key_id,
        model: filters.model,
        source_format: filters.source_format,
      }),
  })
}

export function useSessionDetail(
  sessionId: string | undefined,
  filters: SessionFilters = {},
) {
  return useQuery<SessionDetailResponse>({
    queryKey: ['session-detail', sessionId, filters],
    queryFn: () =>
      apiGet<SessionDetailResponse>(
        `/api/dashboard/sessions/${encodeURIComponent(sessionId || '')}`,
        {
          period: filters.period,
          namespace: filters.namespace,
          api_key: filters.api_key,
          api_key_id: filters.api_key_id,
          model: filters.model,
          source_format: filters.source_format,
        },
      ),
    enabled: Boolean(sessionId),
    retry: (failureCount, error) => {
      const status = (error as { status?: number })?.status
      if (status === 404) return false
      return failureCount < 2
    },
  })
}

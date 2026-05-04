import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type {
  ConfigAuditEventsResponse,
  ConfigRollbackResponse,
  ConfigVersionDetail,
  ConfigVersionsResponse,
} from '@/types/api'

export function useConfigVersions(limit = 50) {
  return useQuery<ConfigVersionsResponse>({
    queryKey: ['config-versions', limit],
    queryFn: () =>
      apiGet<ConfigVersionsResponse>('/api/dashboard/config/versions', {
        limit,
      }),
    staleTime: 15_000,
  })
}

export function useConfigVersion(versionId?: string) {
  return useQuery<ConfigVersionDetail>({
    queryKey: ['config-version', versionId],
    queryFn: () =>
      apiGet<ConfigVersionDetail>(
        `/api/dashboard/config/versions/${encodeURIComponent(versionId || '')}`,
      ),
    enabled: Boolean(versionId),
    retry: (failureCount, error) => {
      const status = (error as { status?: number })?.status
      if (status === 404) return false
      return failureCount < 2
    },
  })
}

export function useConfigAuditEvents(limit = 100) {
  return useQuery<ConfigAuditEventsResponse>({
    queryKey: ['config-audit-events', limit],
    queryFn: () =>
      apiGet<ConfigAuditEventsResponse>('/api/dashboard/config/audit-events', {
        limit,
      }),
    staleTime: 15_000,
  })
}

export function useRollbackConfigVersion() {
  const queryClient = useQueryClient()
  return useMutation<
    ConfigRollbackResponse,
    Error,
    { versionId: string; reason?: string }
  >({
    mutationFn: ({ versionId, reason }) =>
      apiPost<ConfigRollbackResponse>(
        `/api/dashboard/config/versions/${encodeURIComponent(versionId)}/rollback`,
        { reason },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['config-versions'] })
      queryClient.invalidateQueries({ queryKey: ['config-audit-events'] })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['route-decisions'] })
    },
  })
}

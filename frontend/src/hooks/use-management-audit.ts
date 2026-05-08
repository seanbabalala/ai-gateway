import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ManagementAuditEventsResponse, ManagementAuditResult } from '@/types/api'

export interface ManagementAuditFilters {
  limit?: number
  action?: string
  resourceType?: string
  resourceId?: string
  actorId?: string
  result?: ManagementAuditResult | ''
}

export function useManagementAuditEvents(filters: ManagementAuditFilters = {}) {
  const limit = filters.limit ?? 100
  return useQuery<ManagementAuditEventsResponse>({
    queryKey: [
      'management-audit-events',
      limit,
      filters.action || '',
      filters.resourceType || '',
      filters.resourceId || '',
      filters.actorId || '',
      filters.result || '',
    ],
    queryFn: () =>
      apiGet<ManagementAuditEventsResponse>('/api/dashboard/audit', {
        limit,
        action: filters.action,
        resource_type: filters.resourceType,
        resource_id: filters.resourceId,
        actor_id: filters.actorId,
        result: filters.result || undefined,
      }),
    staleTime: 15_000,
  })
}

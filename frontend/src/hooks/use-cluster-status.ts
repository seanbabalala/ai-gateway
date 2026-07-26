import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ClusterStatusResponse } from '@/types/api'

export function useClusterStatus(enabled: boolean = true) {
  return useQuery<ClusterStatusResponse>({
    queryKey: ['cluster-status'],
    queryFn: () => apiGet<ClusterStatusResponse>('/api/dashboard/cluster'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

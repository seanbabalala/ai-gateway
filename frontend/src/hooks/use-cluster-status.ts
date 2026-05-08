import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ClusterStatusResponse } from '@/types/api'

export function useClusterStatus() {
  return useQuery<ClusterStatusResponse>({
    queryKey: ['cluster-status'],
    queryFn: () => apiGet<ClusterStatusResponse>('/api/dashboard/cluster'),
    refetchInterval: 30_000,
  })
}

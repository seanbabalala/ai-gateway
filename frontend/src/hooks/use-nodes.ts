import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { NodesResponse } from '@/types/api'

export function useNodes() {
  return useQuery<NodesResponse>({
    queryKey: ['nodes'],
    queryFn: () => apiGet<NodesResponse>('/api/dashboard/nodes'),
    refetchInterval: 10_000,
  })
}

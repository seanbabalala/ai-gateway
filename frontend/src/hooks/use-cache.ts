import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { CacheStats, ActionResponse } from '@/types/api'

export function useCacheStats(enabled: boolean = true) {
  return useQuery<CacheStats>({
    queryKey: ['cache'],
    queryFn: () => apiGet<CacheStats>('/api/dashboard/cache'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useClearCache() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, void>({
    mutationFn: () => apiPost<ActionResponse>('/api/dashboard/cache/clear'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache'] })
    },
  })
}

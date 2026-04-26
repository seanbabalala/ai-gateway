import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { HealthResponse } from '@/types/api'

export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/health'),
    refetchInterval: 30_000,
  })
}

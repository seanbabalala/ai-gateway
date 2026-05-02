import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ShadowTrafficResponse } from '@/types/api'

export function useShadowTraffic(namespaceId?: string) {
  return useQuery<ShadowTrafficResponse>({
    queryKey: ['shadow-traffic', namespaceId || 'all'],
    queryFn: () =>
      apiGet<ShadowTrafficResponse>('/api/dashboard/shadow', {
        namespace: namespaceId,
      }),
    refetchInterval: 15_000,
  })
}

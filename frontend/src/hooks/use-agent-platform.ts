import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AgentPlatformResponse } from '@/types/api'

export function useAgentPlatform() {
  return useQuery<AgentPlatformResponse>({
    queryKey: ['agent-platform'],
    queryFn: () => apiGet<AgentPlatformResponse>('/api/dashboard/agent-platform'),
    refetchInterval: 15_000,
  })
}

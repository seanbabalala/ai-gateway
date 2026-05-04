import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { McpGatewayResponse } from '@/types/api'

export function useMcpGateway() {
  return useQuery<McpGatewayResponse>({
    queryKey: ['mcp-gateway'],
    queryFn: () => apiGet<McpGatewayResponse>('/api/dashboard/mcp'),
    refetchInterval: 15_000,
  })
}

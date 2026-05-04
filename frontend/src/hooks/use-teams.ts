import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { TeamsResponse } from '@/types/api'

export function useTeams() {
  return useQuery<TeamsResponse>({
    queryKey: ['teams'],
    queryFn: () => apiGet<TeamsResponse>('/api/dashboard/teams'),
  })
}

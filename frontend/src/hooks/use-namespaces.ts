import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { NamespacesResponse } from '@/types/api'

export function useNamespaces() {
  return useQuery<NamespacesResponse>({
    queryKey: ['namespaces'],
    queryFn: () => apiGet<NamespacesResponse>('/api/dashboard/namespaces'),
  })
}

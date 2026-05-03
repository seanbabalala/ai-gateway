import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ModelCatalogResponse } from '@/types/api'

export function useModelCatalog() {
  return useQuery<ModelCatalogResponse>({
    queryKey: ['model-catalog'],
    queryFn: () => apiGet<ModelCatalogResponse>('/api/dashboard/model-catalog'),
    refetchInterval: 60_000,
  })
}

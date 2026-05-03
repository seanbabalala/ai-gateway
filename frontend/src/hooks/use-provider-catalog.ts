import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type {
  CatalogModelsResponse,
  CatalogProvidersResponse,
} from '@/types/api'

export function useProviderCatalogProviders(enabled = true) {
  return useQuery<CatalogProvidersResponse>({
    queryKey: ['provider-catalog', 'providers'],
    queryFn: () => apiGet<CatalogProvidersResponse>('/api/dashboard/catalog/providers'),
    staleTime: 300_000,
    enabled,
  })
}

export function useProviderCatalogModels(filters: {
  provider?: string
  modality?: string
  endpoint?: string
} = {}) {
  return useQuery<CatalogModelsResponse>({
    queryKey: ['provider-catalog', 'models', filters],
    queryFn: () =>
      apiGet<CatalogModelsResponse>('/api/dashboard/catalog/models', filters),
    staleTime: 300_000,
  })
}

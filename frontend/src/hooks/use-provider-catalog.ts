import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type {
  CatalogModelsResponse,
  CatalogProvidersResponse,
} from '@/types/api'

export function useProviderCatalogProviders(
  options: { enabled?: boolean; showLegacy?: boolean } = {},
) {
  const enabled = options.enabled ?? true
  const showLegacy = options.showLegacy ?? false
  return useQuery<CatalogProvidersResponse>({
    queryKey: ['provider-catalog', 'providers', { showLegacy }],
    queryFn: () =>
      apiGet<CatalogProvidersResponse>('/api/dashboard/catalog/providers', {
        show_legacy: showLegacy ? 1 : undefined,
      }),
    staleTime: 300_000,
    enabled,
  })
}

export function useProviderCatalogModels(filters: {
  provider?: string
  modality?: string
  endpoint?: string
  showLegacy?: boolean
} = {}) {
  return useQuery<CatalogModelsResponse>({
    queryKey: ['provider-catalog', 'models', filters],
    queryFn: () =>
      apiGet<CatalogModelsResponse>('/api/dashboard/catalog/models', {
        provider: filters.provider,
        modality: filters.modality,
        endpoint: filters.endpoint,
        show_legacy: filters.showLegacy ? 1 : undefined,
      }),
    staleTime: 300_000,
  })
}

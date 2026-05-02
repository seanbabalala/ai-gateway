import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BudgetResponse, BudgetPerKeyResponse, BudgetKeysResponse } from '@/types/api'

export interface BudgetScope {
  id?: string
  name?: string
}

export function useBudget(scope?: BudgetScope) {
  const key = scope?.id ? `id:${scope.id}` : scope?.name ? `name:${scope.name}` : 'global'
  return useQuery<BudgetResponse | BudgetPerKeyResponse>({
    queryKey: ['budget', key],
    queryFn: () =>
      scope?.id || scope?.name
        ? apiGet<BudgetPerKeyResponse>('/api/dashboard/budget', {
            api_key_id: scope.id,
            api_key: scope.id ? undefined : scope.name,
          })
        : apiGet<BudgetResponse>('/api/dashboard/budget'),
    refetchInterval: 15_000,
  })
}

export function useBudgetKeys() {
  return useQuery<BudgetKeysResponse>({
    queryKey: ['budget', 'keys'],
    queryFn: () => apiGet<BudgetKeysResponse>('/api/dashboard/budget/keys'),
  })
}

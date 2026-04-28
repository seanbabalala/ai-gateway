import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BudgetResponse, BudgetPerKeyResponse, BudgetKeysResponse } from '@/types/api'

export function useBudget(apiKey?: string) {
  return useQuery<BudgetResponse | BudgetPerKeyResponse>({
    queryKey: ['budget', apiKey],
    queryFn: () =>
      apiKey
        ? apiGet<BudgetPerKeyResponse>('/api/dashboard/budget', { api_key: apiKey })
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

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BudgetResponse } from '@/types/api'

export function useBudget() {
  return useQuery<BudgetResponse>({
    queryKey: ['budget'],
    queryFn: () => apiGet<BudgetResponse>('/api/dashboard/budget'),
    refetchInterval: 15_000,
  })
}

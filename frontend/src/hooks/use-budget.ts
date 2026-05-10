import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { BudgetResponse, BudgetKeysResponse } from '@/types/api'

export interface BudgetScope {
  kind?: 'global' | 'namespace' | 'team' | 'api_key'
  id?: string
  name?: string
}

function budgetQuery(scope?: BudgetScope): Promise<BudgetResponse> {
  const kind = scope?.kind || (scope?.id || scope?.name ? 'api_key' : 'global')
  if (kind === 'namespace') {
    return apiGet<BudgetResponse>('/api/dashboard/budget', {
      namespace: scope?.id || scope?.name,
    })
  }
  if (kind === 'team') {
    return apiGet<BudgetResponse>('/api/dashboard/budget', { team_id: scope?.id })
  }
  if (kind === 'api_key') {
    return apiGet<BudgetResponse>('/api/dashboard/budget', {
      api_key_id: scope?.id,
      api_key: scope?.id ? undefined : scope?.name,
    })
  }
  return apiGet<BudgetResponse>('/api/dashboard/budget')
}

export function useBudget(scope?: BudgetScope) {
  return useQuery<BudgetResponse>({
    queryKey: ['budget', budgetScopeKey(scope || { kind: 'global' })],
    queryFn: () => budgetQuery(scope),
    refetchInterval: 15_000,
  })
}

export function useBudgetSnapshots(scopes: BudgetScope[]) {
  return useQuery<Record<string, BudgetResponse>>({
    queryKey: ['budget', 'snapshots', scopes.map(budgetScopeKey).join('|')],
    queryFn: async () => {
      const entries = await Promise.all(
        scopes.map(async (scope) => {
          return [budgetScopeKey(scope), await budgetQuery(scope)] as const
        }),
      )
      return Object.fromEntries(entries)
    },
    enabled: scopes.length > 0,
    refetchInterval: 15_000,
  })
}

export function budgetScopeKey(scope: BudgetScope): string {
  return `${scope.kind || 'global'}:${scope.id || scope.name || 'global'}`
}

export function parseBudgetScopeKey(key: string): BudgetScope {
  const [kind, ...rest] = key.split(':')
  const value = rest.join(':')
  if (kind === 'namespace' || kind === 'team' || kind === 'api_key') {
    return {
      kind,
      id: value || undefined,
    }
  }
  if (kind === 'api_key_name') {
    return {
      kind: 'api_key',
      name: value,
    }
  }
  return { kind: 'global' }
}

export function useBudgetKeys() {
  return useQuery<BudgetKeysResponse>({
    queryKey: ['budget', 'keys'],
    queryFn: () => apiGet<BudgetKeysResponse>('/api/dashboard/budget/keys'),
  })
}

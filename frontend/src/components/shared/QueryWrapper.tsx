import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ErrorState } from '@/components/ui/error-state'

interface QueryWrapperProps<T> {
  query: UseQueryResult<T>
  skeleton: ReactNode
  children: (data: T) => ReactNode
}

/**
 * Unified loading / error / data three-state wrapper for React Query results.
 * Usage:
 * ```
 * <QueryWrapper query={statsQuery} skeleton={<SkeletonCard />}>
 *   {(data) => <Dashboard stats={data} />}
 * </QueryWrapper>
 * ```
 */
export function QueryWrapper<T>({ query, skeleton, children }: QueryWrapperProps<T>) {
  if (query.isLoading) {
    return <>{skeleton}</>
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }

  if (!query.data) {
    return <>{skeleton}</>
  }

  return <>{children(query.data)}</>
}

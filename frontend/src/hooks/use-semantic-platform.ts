import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type {
  CreateSemanticPromptTemplateRequest,
  CreateSemanticPromptTemplateResponse,
  SemanticPlatformResponse,
} from '@/types/api'

export function useSemanticPlatform(period: string) {
  return useQuery<SemanticPlatformResponse>({
    queryKey: ['semantic-platform', period],
    queryFn: () =>
      apiGet<SemanticPlatformResponse>('/api/dashboard/semantic-platform', {
        period,
      }),
    refetchInterval: 20_000,
  })
}

export function useCreateSemanticPromptTemplate() {
  const queryClient = useQueryClient()
  return useMutation<CreateSemanticPromptTemplateResponse, Error, CreateSemanticPromptTemplateRequest>({
    mutationFn: (payload) =>
      apiPost<CreateSemanticPromptTemplateResponse>('/api/dashboard/semantic-platform/prompt-templates', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['semantic-platform'] })
    },
  })
}

export function useInvalidateSemanticCache() {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean; scope: string }, Error, { scope: 'workspace' | 'all' }>({
    mutationFn: (payload) =>
      apiPost<{ success: boolean; scope: string }>('/api/dashboard/semantic-platform/semantic-cache/invalidate', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['semantic-platform'] })
    },
  })
}

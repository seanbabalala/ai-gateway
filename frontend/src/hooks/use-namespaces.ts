import { useQuery } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import type {
  CreateNamespaceRequest,
  NamespaceMutationResponse,
  NamespacesResponse,
  UpdateNamespaceRequest,
} from '@/types/api'

export function useNamespaces() {
  return useQuery<NamespacesResponse>({
    queryKey: ['namespaces'],
    queryFn: () => apiGet<NamespacesResponse>('/api/dashboard/namespaces'),
  })
}

export function useCreateNamespace() {
  const queryClient = useQueryClient()
  return useMutation<NamespaceMutationResponse, Error, CreateNamespaceRequest>({
    mutationFn: (data) => apiPost<NamespaceMutationResponse>('/api/dashboard/namespaces', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] })
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

export function useUpdateNamespace() {
  const queryClient = useQueryClient()
  return useMutation<NamespaceMutationResponse, Error, { id: string; data: UpdateNamespaceRequest }>({
    mutationFn: ({ id, data }) =>
      apiPut<NamespaceMutationResponse>(`/api/dashboard/namespaces/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] })
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

export function useDeleteNamespace() {
  const queryClient = useQueryClient()
  return useMutation<
    NamespaceMutationResponse,
    Error,
    { id: string; confirmImpact?: boolean }
  >({
    mutationFn: ({ id, confirmImpact }) =>
      apiDelete<NamespaceMutationResponse>(
        `/api/dashboard/namespaces/${id}`,
        confirmImpact ? { confirm_impact: true } : undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] })
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

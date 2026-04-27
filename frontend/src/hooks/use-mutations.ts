import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, apiPut, apiDelete } from '@/lib/api'
import type { ActionResponse, CreateNodeRequest, UpdateNodeRequest, TestNodeRequest, TestNodeResponse } from '@/types/api'

export function useResetBudget() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (ruleType: string) =>
      apiPost<ActionResponse>(`/api/dashboard/budget/${ruleType}/reset`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useResetCircuit() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, { nodeId: string; model?: string }>({
    mutationFn: ({ nodeId, model }) => {
      const url = model
        ? `/api/dashboard/nodes/${nodeId}/reset?model=${encodeURIComponent(model)}`
        : `/api/dashboard/nodes/${nodeId}/reset`
      return apiPost<ActionResponse>(url)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useReloadConfig() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, void>({
    mutationFn: () => apiPost<ActionResponse>('/api/dashboard/config/reload'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useCreateNode() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, CreateNodeRequest>({
    mutationFn: (data) =>
      apiPost<ActionResponse>('/api/dashboard/nodes', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useUpdateNode() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, { nodeId: string; data: UpdateNodeRequest }>({
    mutationFn: ({ nodeId, data }) =>
      apiPut<ActionResponse>(`/api/dashboard/nodes/${nodeId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useDeleteNode() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (nodeId) =>
      apiDelete<ActionResponse>(`/api/dashboard/nodes/${nodeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useTestNode() {
  return useMutation<TestNodeResponse, Error, TestNodeRequest>({
    mutationFn: (data) =>
      apiPost<TestNodeResponse>('/api/dashboard/nodes/test', data),
  })
}

export function useTestExistingNode() {
  return useMutation<TestNodeResponse, Error, string>({
    mutationFn: (nodeId) =>
      apiPost<TestNodeResponse>(`/api/dashboard/nodes/${nodeId}/test`),
  })
}

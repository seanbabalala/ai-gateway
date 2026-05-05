import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, apiPut, apiDelete } from '@/lib/api'
import type {
  ActionResponse,
  CreateTeamRequest,
  CreateGatewayApiKeyRequest,
  CreateNodeRequest,
  GatewayApiKeyMutationResponse,
  TeamMutationResponse,
  TestNodeRequest,
  TestNodeResponse,
  UpdateGatewayApiKeyRequest,
  UpdateTeamRequest,
  UpdateNodeRequest,
} from '@/types/api'

export function useResetBudget() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, number>({
    mutationFn: (ruleId: number) =>
      apiPost<ActionResponse>(`/api/dashboard/budget/${ruleId}/reset`),
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
  const queryClient = useQueryClient()
  return useMutation<TestNodeResponse, Error, string>({
    mutationFn: (nodeId) =>
      apiPost<TestNodeResponse>(`/api/dashboard/nodes/${nodeId}/test`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}

export function useCreateGatewayApiKey() {
  const queryClient = useQueryClient()
  return useMutation<GatewayApiKeyMutationResponse, Error, CreateGatewayApiKeyRequest>({
    mutationFn: (data) =>
      apiPost<GatewayApiKeyMutationResponse>('/api/dashboard/api-keys', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation<TeamMutationResponse, Error, CreateTeamRequest>({
    mutationFn: (data) =>
      apiPost<TeamMutationResponse>('/api/dashboard/teams', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useUpdateTeam() {
  const queryClient = useQueryClient()
  return useMutation<
    TeamMutationResponse,
    Error,
    { id: string; data: UpdateTeamRequest }
  >({
    mutationFn: ({ id, data }) =>
      apiPut<TeamMutationResponse>(`/api/dashboard/teams/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useDeleteTeam() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (id) =>
      apiDelete<ActionResponse>(`/api/dashboard/teams/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useUpdateGatewayApiKey() {
  const queryClient = useQueryClient()
  return useMutation<
    GatewayApiKeyMutationResponse,
    Error,
    { id: string; data: UpdateGatewayApiKeyRequest }
  >({
    mutationFn: ({ id, data }) =>
      apiPut<GatewayApiKeyMutationResponse>(`/api/dashboard/api-keys/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useRotateGatewayApiKey() {
  const queryClient = useQueryClient()
  return useMutation<GatewayApiKeyMutationResponse, Error, string>({
    mutationFn: (id) =>
      apiPost<GatewayApiKeyMutationResponse>(`/api/dashboard/api-keys/${id}/rotate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
}

export function useDeleteGatewayApiKey() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (id) =>
      apiDelete<ActionResponse>(`/api/dashboard/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

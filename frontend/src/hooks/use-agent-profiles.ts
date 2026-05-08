import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import type {
  ActionResponse,
  AgentProfileMutationResponse,
  AgentProfileRenderResponse,
  AgentProfilesResponse,
  CreateAgentProfileRequest,
  RenderAgentProfileRequest,
  UpdateAgentProfileRequest,
} from '@/types/api'

export function useAgentProfiles() {
  return useQuery<AgentProfilesResponse>({
    queryKey: ['agent-profiles'],
    queryFn: () => apiGet<AgentProfilesResponse>('/api/dashboard/agent-profiles'),
  })
}

export function useCreateAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation<AgentProfileMutationResponse, Error, CreateAgentProfileRequest>({
    mutationFn: (data) => apiPost<AgentProfileMutationResponse>('/api/dashboard/agent-profiles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] })
    },
  })
}

export function useUpdateAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation<
    AgentProfileMutationResponse,
    Error,
    { id: string; data: UpdateAgentProfileRequest }
  >({
    mutationFn: ({ id, data }) =>
      apiPut<AgentProfileMutationResponse>(`/api/dashboard/agent-profiles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] })
    },
  })
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (id) => apiDelete<ActionResponse>(`/api/dashboard/agent-profiles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] })
    },
  })
}

export function useRenderAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation<
    AgentProfileRenderResponse,
    Error,
    { id: string; data?: RenderAgentProfileRequest }
  >({
    mutationFn: ({ id, data }) =>
      apiPost<AgentProfileRenderResponse>(`/api/dashboard/agent-profiles/${id}/render`, data || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] })
    },
  })
}

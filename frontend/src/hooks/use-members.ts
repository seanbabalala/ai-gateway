import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import type {
  WorkspaceInvitationMutationResponse,
  WorkspaceInvitationsResponse,
  WorkspaceInvitationStatus,
  WorkspaceMemberMutationResponse,
  WorkspaceMembersResponse,
  WorkspaceMemberStatus,
  WorkspaceRole,
} from '@/types/api'

export function useWorkspaceMembers(enabled = true) {
  return useQuery<WorkspaceMembersResponse>({
    queryKey: ['workspace-members'],
    queryFn: () => apiGet<WorkspaceMembersResponse>('/api/dashboard/members'),
    enabled,
  })
}

export function useWorkspaceInvitations(enabled = true) {
  return useQuery<WorkspaceInvitationsResponse>({
    queryKey: ['workspace-invitations'],
    queryFn: () => apiGet<WorkspaceInvitationsResponse>('/api/dashboard/members/invitations'),
    enabled,
  })
}

export function useCreateWorkspaceInvitation() {
  const queryClient = useQueryClient()
  return useMutation<
    WorkspaceInvitationMutationResponse,
    Error,
    { email?: string; role: WorkspaceRole; expires_in_hours?: number }
  >({
    mutationFn: (body) =>
      apiPost<WorkspaceInvitationMutationResponse>('/api/dashboard/members/invitations', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] })
    },
  })
}

export function useRevokeWorkspaceInvitation() {
  const queryClient = useQueryClient()
  return useMutation<
    WorkspaceInvitationMutationResponse,
    Error,
    { id: string; status?: WorkspaceInvitationStatus }
  >({
    mutationFn: ({ id }) =>
      apiDelete<WorkspaceInvitationMutationResponse>(`/api/dashboard/members/invitations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] })
    },
  })
}

export function useUpdateWorkspaceMember() {
  const queryClient = useQueryClient()
  return useMutation<
    WorkspaceMemberMutationResponse,
    Error,
    { id: string; role?: WorkspaceRole; status?: WorkspaceMemberStatus }
  >({
    mutationFn: ({ id, role, status }) =>
      apiPut<WorkspaceMemberMutationResponse>(`/api/dashboard/members/${id}`, {
        role,
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut } from '@/lib/api'
import type {
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

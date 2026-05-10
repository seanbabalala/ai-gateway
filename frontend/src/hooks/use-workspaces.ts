import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, apiPut, getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/api'
import type { WorkspaceAccess, WorkspaceMutationResponse, WorkspaceState } from '@/types/api'

export function useWorkspaces() {
  const [data, setData] = useState<WorkspaceState | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const state = await apiGet<WorkspaceState>('/api/dashboard/workspaces')
      setData(state)
      if (!getActiveWorkspaceId()) {
        setActiveWorkspaceId(state.active_workspace.id)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const result = await apiPost<{ state: WorkspaceState }>(
      '/api/dashboard/workspaces/switch',
      { workspace_id: workspaceId },
    )
    setActiveWorkspaceId(workspaceId)
    setData(result.state)
    window.dispatchEvent(new CustomEvent('siftgate:workspace-change', {
      detail: { workspaceId },
    }))
  }, [])

  const applyMutationResult = useCallback((result: WorkspaceMutationResponse) => {
    setData(result.state)
    setActiveWorkspaceId(result.state.active_workspace.id)
    window.dispatchEvent(new CustomEvent('siftgate:workspace-change', {
      detail: { workspaceId: result.state.active_workspace.id },
    }))
    return result
  }, [])

  const createWorkspace = useCallback(
    async (body: { name: string; slug?: string }) => {
      const result = await apiPost<WorkspaceMutationResponse>('/api/dashboard/workspaces', body)
      return applyMutationResult(result)
    },
    [applyMutationResult],
  )

  const renameWorkspace = useCallback(
    async (workspaceId: string, body: { name?: string; slug?: string }) => {
      const result = await apiPut<WorkspaceMutationResponse>(`/api/dashboard/workspaces/${workspaceId}`, body)
      return applyMutationResult(result)
    },
    [applyMutationResult],
  )

  const disableWorkspace = useCallback(
    async (workspaceId: string) => {
      const result = await apiPost<WorkspaceMutationResponse>(`/api/dashboard/workspaces/${workspaceId}/disable`)
      return applyMutationResult(result)
    },
    [applyMutationResult],
  )

  const reactivateWorkspace = useCallback(
    async (workspaceId: string) => {
      const result = await apiPost<WorkspaceMutationResponse>(`/api/dashboard/workspaces/${workspaceId}/reactivate`)
      return applyMutationResult(result)
    },
    [applyMutationResult],
  )

  return {
    data,
    isLoading,
    refresh,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    disableWorkspace,
    reactivateWorkspace,
  }
}

export function hasWorkspaceRole(
  access: WorkspaceAccess | null | undefined,
  required: 'viewer' | 'operator' | 'admin',
) {
  const rank = { viewer: 1, operator: 2, admin: 3 }
  return rank[access?.role || 'viewer'] >= rank[required]
}

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/api'
import type { WorkspaceAccess } from '@/types/api'

export interface WorkspaceSummary {
  id: string
  organization_id: string
  name: string
  slug: string
  status: string
  is_default: boolean
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  status: string
}

export interface WorkspaceState {
  organization: OrganizationSummary
  active_workspace: WorkspaceSummary
  default_workspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  access?: WorkspaceAccess
}

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

  return { data, isLoading, refresh, switchWorkspace }
}

export function hasWorkspaceRole(
  access: WorkspaceAccess | null | undefined,
  required: 'viewer' | 'operator' | 'admin',
) {
  const rank = { viewer: 1, operator: 2, admin: 3 }
  return rank[access?.role || 'viewer'] >= rank[required]
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { createSSEConnection } from '@/lib/sse'
import type { CallLog, SSEEvent } from '@/types/api'
import { useWorkspaces } from './use-workspaces'

export function useSSELogs(maxItems: number = 50, enabled: boolean = true) {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [connected, setConnected] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const { data: workspaceState } = useWorkspaces()
  const workspaceId = workspaceState?.active_workspace.id ?? ''
  const logsRef = useRef(logs)
  logsRef.current = logs

  useEffect(() => {
    if (!enabled) return
    setLogs([])
    setNewCount(0)
    setConnected(false)
    const cleanup = createSSEConnection(
      '/api/dashboard/logs/sse',
      (event: SSEEvent) => {
        if (event.type === 'connected') {
          setConnected(true)
        } else if (event.type === 'log') {
          setLogs((prev) => {
            const next = [event.log, ...prev].slice(0, maxItems)
            return next
          })
          setNewCount((c) => c + 1)
        }
        // heartbeat — just confirms connection is alive
      },
      () => {
        setConnected(false)
      },
    )

    return cleanup
  }, [enabled, maxItems, workspaceId])

  const clearNewCount = useCallback(() => {
    setNewCount(0)
  }, [])

  return { logs, connected, newCount, clearNewCount }
}

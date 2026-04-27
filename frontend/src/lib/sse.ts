import type { SSEEvent } from '@/types/api'
import { getAuthToken } from '@/contexts/AuthContext'

export function createSSEConnection(
  url: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  // Append JWT token as query param (EventSource doesn't support custom headers)
  let sseUrl = url
  const token = getAuthToken()
  if (token) {
    const separator = url.includes('?') ? '&' : '?'
    sseUrl = `${url}${separator}token=${encodeURIComponent(token)}`
  }

  const eventSource = new EventSource(sseUrl)

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SSEEvent
      onEvent(data)
    } catch {
      // ignore parse errors
    }
  }

  eventSource.onerror = (e) => {
    onError?.(e)
  }

  // Return cleanup function
  return () => {
    eventSource.close()
  }
}

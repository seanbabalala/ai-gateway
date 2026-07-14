import type { SSEEvent } from '@/types/api'
import { getAuthToken } from '@/contexts/AuthContext'

export function createSSEConnection(
  url: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  let eventSource: EventSource | null = null
  let opened = false
  let usingLegacyToken = false
  let closed = false

  const connect = (sseUrl: string) => {
    const source = new EventSource(sseUrl)

    source.onopen = () => {
      opened = true
    }

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent
        onEvent(data)
      } catch {
        // ignore parse errors
      }
    }

    source.onerror = (e) => {
      if (closed) return
      if (!opened && !usingLegacyToken) {
        const token = getAuthToken()
        if (token) {
          usingLegacyToken = true
          source.close()
          eventSource = connect(withToken(url, token))
          return
        }
      }
      onError?.(e)
    }

    return source
  }

  eventSource = connect(url)

  return () => {
    closed = true
    eventSource?.close()
  }
}

function withToken(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}

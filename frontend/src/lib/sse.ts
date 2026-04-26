import type { SSEEvent } from '@/types/api'

export function createSSEConnection(
  url: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const eventSource = new EventSource(url)

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

import { useMutation } from '@tanstack/react-query'
import { apiPost } from '@/lib/api'
import type { PlaygroundRunRequest, PlaygroundRunResponse } from '@/types/api'

export function usePlaygroundRun() {
  return useMutation<PlaygroundRunResponse, Error, PlaygroundRunRequest>({
    mutationFn: (data) =>
      apiPost<PlaygroundRunResponse>('/api/dashboard/playground/run', data),
  })
}

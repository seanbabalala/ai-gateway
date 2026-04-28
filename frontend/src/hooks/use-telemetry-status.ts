import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'

interface TelemetryStatus {
  enabled: boolean
  active: boolean
  config: {
    service_name: string
    traces_endpoint: string
    sample_rate: number
    prometheus_port: number
    otlp_metrics_endpoint: string | null
  } | null
}

export function useTelemetryStatus() {
  return useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: () => apiGet<TelemetryStatus>('/api/dashboard/telemetry-status'),
    refetchInterval: 60_000, // refresh every minute
  })
}

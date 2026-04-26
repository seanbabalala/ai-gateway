import { Badge } from '@/components/ui/badge'

interface CircuitBadgeProps {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
}

const circuitVariantMap: Record<string, 'emerald' | 'red' | 'amber'> = {
  CLOSED: 'emerald',
  OPEN: 'red',
  HALF_OPEN: 'amber',
}

const circuitLabels: Record<string, string> = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF OPEN',
}

export function CircuitBadge({ state }: CircuitBadgeProps) {
  return (
    <Badge variant={circuitVariantMap[state] ?? 'zinc'}>
      {circuitLabels[state] ?? state}
    </Badge>
  )
}

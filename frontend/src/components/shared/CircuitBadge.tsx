import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

interface CircuitBadgeProps {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
}

const circuitVariantMap: Record<string, 'emerald' | 'red' | 'amber'> = {
  CLOSED: 'emerald',
  OPEN: 'red',
  HALF_OPEN: 'amber',
}

export function CircuitBadge({ state }: CircuitBadgeProps) {
  const { t } = useTranslation('common')
  return (
    <Badge variant={circuitVariantMap[state] ?? 'zinc'}>
      {t(`circuit.${state}`, { defaultValue: state })}
    </Badge>
  )
}

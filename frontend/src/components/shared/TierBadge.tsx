import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

interface TierBadgeProps {
  tier: string
}

const tierVariantMap: Record<string, 'emerald' | 'blue' | 'purple' | 'pink' | 'zinc'> = {
  simple: 'emerald',
  standard: 'blue',
  complex: 'purple',
  reasoning: 'pink',
  direct: 'zinc',
}

export function TierBadge({ tier }: TierBadgeProps) {
  const { t } = useTranslation('common')
  const variant = tierVariantMap[tier] ?? 'zinc'

  return (
    <Badge variant={variant}>
      {t(`tier.${tier}`, { defaultValue: tier })}
    </Badge>
  )
}

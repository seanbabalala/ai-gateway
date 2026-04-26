import { Badge } from '@/components/ui/badge'
import { TIER_COLORS } from '@/lib/utils'

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
  const variant = tierVariantMap[tier] ?? 'zinc'
  const colors = TIER_COLORS[tier]

  return (
    <Badge variant={variant} className={colors ? undefined : undefined}>
      {tier}
    </Badge>
  )
}

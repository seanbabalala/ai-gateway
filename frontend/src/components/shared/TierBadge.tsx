import { Badge } from '@/components/ui/badge'

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

  return (
    <Badge variant={variant}>
      {tier}
    </Badge>
  )
}

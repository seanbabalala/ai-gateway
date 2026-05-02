// ===================================================================
// CapabilityBadge — Single capability tag display
// ===================================================================

import { CAPABILITY_MAP } from '@/lib/capabilities'
import { useTranslation } from 'react-i18next'

interface CapabilityBadgeProps {
  capabilityId: string
  size?: 'sm' | 'md'
}

export function CapabilityBadge({ capabilityId, size = 'sm' }: CapabilityBadgeProps) {
  const { t } = useTranslation('nodes')
  const cap = CAPABILITY_MAP[capabilityId]
  if (!cap) {
    // Unknown capability — render as plain text
    return (
      <span className="inline-flex items-center rounded-lg bg-stone-500/8 px-2 py-0.5 text-[10px] font-semibold text-stone-600 dark:text-stone-400 border border-stone-500/10">
        {capabilityId}
      </span>
    )
  }

  const Icon = cap.icon
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2 py-0.5 gap-1'
    : 'text-[11px] px-2.5 py-1 gap-1.5'
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <span
      className={`inline-flex items-center rounded-lg font-semibold border transition-colors ${sizeClasses} ${cap.bgClass} ${cap.borderClass} ${cap.textClass}`}
    >
      <Icon className={iconSize} />
      {t(`capabilities.${capabilityId}`, { defaultValue: cap.label.en })}
    </span>
  )
}

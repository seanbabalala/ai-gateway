import {
  Eye,
  FileCog,
  FlaskConical,
  PlugZap,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'

export type ClarityBadgeKind =
  | 'readOnly'
  | 'configDriven'
  | 'preview'
  | 'ossFixedRoles'
  | 'runtimeSupported'
  | 'requiresConfig'

const badgeMeta: Record<ClarityBadgeKind, { icon: LucideIcon; variant: BadgeProps['variant'] }> = {
  readOnly: { icon: Eye, variant: 'zinc' },
  configDriven: { icon: FileCog, variant: 'blue' },
  preview: { icon: FlaskConical, variant: 'gold' },
  ossFixedRoles: { icon: ShieldCheck, variant: 'emerald' },
  runtimeSupported: { icon: PlugZap, variant: 'emerald' },
  requiresConfig: { icon: Settings2, variant: 'amber' },
}

export function ClarityBadge({ kind }: { kind: ClarityBadgeKind }) {
  const { t } = useTranslation('common')
  const meta = badgeMeta[kind]
  const Icon = meta.icon
  const label = t(`clarity.${kind}.label`)

  return (
    <Tooltip content={t(`clarity.${kind}.description`)} side="bottom">
      <Badge variant={meta.variant} className="gap-1.5 whitespace-nowrap">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    </Tooltip>
  )
}

export function ClarityBadgeGroup({ kinds }: { kinds: ClarityBadgeKind[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {kinds.map((kind) => (
        <ClarityBadge key={kind} kind={kind} />
      ))}
    </div>
  )
}

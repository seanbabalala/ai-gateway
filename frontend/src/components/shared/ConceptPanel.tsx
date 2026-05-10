import { Info, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CardStatic, CardContent } from '@/components/ui/card'
import { ClarityBadgeGroup, type ClarityBadgeKind } from '@/components/shared/ClarityBadge'

export function ConceptPanel({
  conceptId,
  badgeKinds,
  icon: Icon = Info,
}: {
  conceptId: string
  badgeKinds: ClarityBadgeKind[]
  icon?: LucideIcon
}) {
  const { t } = useTranslation('common')

  return (
    <CardStatic>
      <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold text-[var(--foreground)]">
              {t(`concepts.${conceptId}.title`)}
            </div>
            <p className="mt-1 max-w-4xl text-[12px] font-medium leading-5 text-[var(--foreground-dim)]">
              {t(`concepts.${conceptId}.description`)}
            </p>
          </div>
        </div>
        <ClarityBadgeGroup kinds={badgeKinds} />
      </CardContent>
    </CardStatic>
  )
}

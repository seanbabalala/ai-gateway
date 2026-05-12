import { type ReactNode, useState } from 'react'
import { ChevronDown, ChevronRight, LifeBuoy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type GuidanceVisibility = 'expanded' | 'collapsed'

const STORAGE_PREFIX = 'siftgate.dashboard.guidance.'

function readGuidancePreference(storageKey: string): GuidanceVisibility | null {
  if (typeof window === 'undefined') return null

  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`)
    return value === 'expanded' || value === 'collapsed' ? value : null
  } catch {
    return null
  }
}

function writeGuidancePreference(storageKey: string, value: GuidanceVisibility) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, value)
  } catch {
    // Some hardened browser profiles block localStorage; the computed default still works.
  }
}

export function GuidanceSection({
  storageKey,
  complete,
  children,
  className,
}: {
  storageKey: string
  complete: boolean
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation('common')
  const [visibilityPreference, setVisibilityPreference] = useState<GuidanceVisibility | null>(() =>
    readGuidancePreference(storageKey),
  )
  const collapsed = visibilityPreference === null ? complete : visibilityPreference === 'collapsed'
  const toggle = () => {
    const nextVisibility: GuidanceVisibility = collapsed ? 'expanded' : 'collapsed'
    setVisibilityPreference(nextVisibility)
    writeGuidancePreference(storageKey, nextVisibility)
  }

  return (
    <section className={cn('space-y-3', className)}>
      <CardStatic className="overflow-hidden">
        <CardContent className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--background-tertiary)] text-[var(--accent)]">
              <LifeBuoy className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-extrabold text-[var(--foreground)]">
                {t('guidance.title')}
              </div>
              <p className="mt-0.5 text-[11px] font-medium leading-5 text-[var(--foreground-dim)]">
                {complete ? t('guidance.summary.ready') : t('guidance.summary.todo')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggle}
            aria-expanded={!collapsed}
            className="h-8 shrink-0 px-2.5"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="max-w-[160px] truncate">
              {collapsed ? t('guidance.actions.show') : t('guidance.actions.hide')}
            </span>
          </Button>
        </CardContent>
      </CardStatic>
      {!collapsed && <div className="space-y-3">{children}</div>}
    </section>
  )
}

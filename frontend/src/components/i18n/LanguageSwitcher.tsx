import { Check, ChevronDown, Languages } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  localeStorageKey,
  normalizeLocale,
  supportedLocales,
  type SupportedLocale,
} from '@/i18n'
import { cn } from '@/lib/utils'

interface LanguageSwitcherProps {
  className?: string
  compact?: boolean
}

export function LanguageSwitcher({ className, compact = false }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const currentLocale = normalizeLocale(i18n.language)
  const currentLanguage =
    supportedLocales.find((locale) => locale.code === currentLocale) ?? supportedLocales[0]
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleChange = (locale: SupportedLocale) => {
    localStorage.setItem(localeStorageKey, locale)
    void i18n.changeLanguage(locale)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative z-50 w-full', compact && 'w-auto')}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={t('language.label')}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-[var(--background-secondary)] px-2.5 text-[12px] font-semibold text-[var(--foreground-dim)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_14px_30px_rgba(5,46,36,0.09)]',
          compact && 'h-10 w-10 justify-center px-0',
          className,
        )}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {compact ? (
          <span className="font-mono text-[11px] font-black uppercase tracking-normal">
            {currentLanguage.shortName}
          </span>
        ) : (
          <>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">{t('language.label')}</span>
              <span className="truncate text-[var(--foreground)]">{currentLanguage.name}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
            />
          </>
        )}
      </button>

      {open && (
        <div
          aria-label={t('language.label')}
          className={cn(
            'absolute z-50 rounded-lg border border-white/10 bg-[#08261f] p-1.5 shadow-[0_22px_60px_rgba(0,0,0,0.32)]',
            compact ? 'bottom-0 left-full ml-2 w-44' : 'bottom-full left-0 mb-2 w-full min-w-44',
          )}
          id={menuId}
          role="menu"
        >
          {supportedLocales.map((locale) => {
            const selected = locale.code === currentLocale

            return (
              <button
                aria-checked={selected}
                className={cn(
                  'flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-[12px] font-semibold text-[#cce9dc] transition-colors hover:bg-white/[0.08] hover:text-white',
                  selected && 'bg-[#22d7a8]/15 text-[#e8fff7]',
                )}
                key={locale.code}
                role="menuitemradio"
                type="button"
                onClick={() => handleChange(locale.code)}
              >
                <span>{locale.name}</span>
                {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

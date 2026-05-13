import { Sun, Moon, Monitor } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

const modes: { mode: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { mode: 'light', icon: Sun, labelKey: 'theme.light' },
  { mode: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { mode: 'system', icon: Monitor, labelKey: 'theme.system' },
]

export function ThemeToggle() {
  const { t } = useTranslation('common')
  const { mode, setMode } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.mode')}
      className="relative flex h-9 items-center rounded-lg bg-[var(--background-secondary)] p-0.5 shadow-[0_1px_2px_rgba(5,46,36,0.05)]"
    >
      {modes.map(({ mode: m, icon: Icon, labelKey }) => {
        const label = t(labelKey)
        return (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          onClick={() => setMode(m)}
          title={label}
          className={cn(
            'relative z-10 flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-200 cursor-pointer',
            mode === m
              ? 'text-white'
              : 'text-[var(--foreground-dim)] hover:text-[var(--foreground-muted)]'
          )}
        >
          {mode === m && (
            <motion.div
              layoutId="theme-toggle-indicator"
              className="absolute inset-0 rounded-md bg-[var(--accent)]"
              style={{ boxShadow: '0 8px 18px rgba(5,46,36,0.14)' }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <Icon className="relative z-10 h-3.5 w-3.5" />
        </button>
        )
      })}
    </div>
  )
}

import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

const modes: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun, label: 'Light' },
  { mode: 'dark', icon: Moon, label: 'Dark' },
  { mode: 'system', icon: Monitor, label: 'System' },
]

export function ThemeToggle() {
  const { mode, setMode } = useTheme()

  return (
    <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background-tertiary)] p-0.5">
      {modes.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          title={label}
          className={cn(
            'flex items-center justify-center rounded-md p-1.5 transition-colors duration-150 cursor-pointer',
            mode === m
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--foreground-dim)] hover:text-[var(--foreground-muted)]'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}

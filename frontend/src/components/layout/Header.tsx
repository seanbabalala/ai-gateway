import { Search, Bell } from 'lucide-react'
import { useHealth } from '@/hooks/use-health'
import { StatusDot } from '@/components/shared/StatusDot'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

export function Header() {
  const { data: health } = useHealth()

  return (
    <header
      className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--background-secondary)] px-8"
      style={{ boxShadow: 'var(--header-shadow)' }}
    >
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background-tertiary)] px-3 py-1.5">
        <Search className="h-4 w-4 text-[var(--foreground-dim)]" />
        <input
          type="text"
          placeholder="Search..."
          className="w-48 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--foreground-dim)] outline-none"
        />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <button className="relative flex items-center justify-center rounded-lg p-2 text-[var(--foreground-dim)] transition-colors hover:bg-[var(--background-tertiary)] hover:text-[var(--foreground-muted)] cursor-pointer">
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2.5">
          <StatusDot
            status={
              health?.status === 'healthy'
                ? 'healthy'
                : health?.status === 'degraded'
                  ? 'degraded'
                  : 'unknown'
            }
            size="sm"
          />
          <span className="text-xs text-[var(--foreground-dim)]">
            Gateway{' '}
            <span className="text-[var(--foreground-muted)]">
              {health?.status === 'healthy'
                ? 'Online'
                : health?.status === 'degraded'
                  ? 'Degraded'
                  : '...'}
            </span>
          </span>
        </div>
        {/* User avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
          A
        </div>
      </div>
    </header>
  )
}

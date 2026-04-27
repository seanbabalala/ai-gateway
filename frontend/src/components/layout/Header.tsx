import { Search, Bell } from 'lucide-react'
import { useHealth } from '@/hooks/use-health'
import { StatusDot } from '@/components/shared/StatusDot'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

export function Header() {
  const { data: health } = useHealth()

  return (
    <header
      className="relative z-10 flex h-[56px] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--glass-bg)] px-8"
      style={{
        boxShadow: 'var(--header-shadow)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Search input */}
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-3.5 py-2 transition-all duration-200 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-muted)]">
        <Search className="h-3.5 w-3.5 text-[var(--foreground-dim)]" />
        <input
          type="text"
          placeholder="Search logs, nodes, models..."
          className="w-56 bg-transparent text-[13px] text-[var(--foreground)] placeholder:text-[var(--foreground-dim)] outline-none"
        />
        <kbd className="hidden sm:inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--background-secondary)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--foreground-dim)]">
          /
        </kbd>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        <ThemeToggle />

        <button className="relative flex items-center justify-center rounded-xl p-2.5 text-[var(--foreground-dim)] transition-all duration-200 hover:bg-[var(--inset-bg)] hover:text-[var(--foreground-muted)] cursor-pointer">
          <Bell className="h-4 w-4" />
        </button>

        {/* Gateway status pill */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-3 py-1.5">
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
          <span className="text-[11px] font-medium text-[var(--foreground-dim)]">
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
        <div
          className="flex h-8 w-8 items-center justify-center rounded-xl text-[11px] font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, #D4A947 0%, #B8860B 100%)',
            boxShadow: '0 0 16px rgba(212, 169, 71, 0.2)',
          }}
        >
          A
        </div>
      </div>
    </header>
  )
}

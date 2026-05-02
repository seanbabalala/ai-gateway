import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, Search, LogOut, Menu } from 'lucide-react'
import { useHealth } from '@/hooks/use-health'
import { useAuth } from '@/contexts/AuthContext'
import { StatusDot } from '@/components/shared/StatusDot'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Tooltip } from '@/components/ui/tooltip'

interface HeaderProps {
  onToggleSidebar?: () => void
  showHamburger?: boolean
}

export function Header({ onToggleSidebar, showHamburger }: HeaderProps) {
  const { t } = useTranslation('common')
  const { data: health } = useHealth()
  const { authRequired, logout } = useAuth()
  const navigate = useNavigate()
  const [searchValue, setSearchValue] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // `/` keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchValue.trim()) {
      navigate(`/logs?search=${encodeURIComponent(searchValue.trim())}`)
      setSearchValue('')
      searchRef.current?.blur()
    }
  }

  return (
    <header
      className="relative z-10 flex h-[58px] shrink-0 items-center justify-between bg-[var(--background)] px-4 sm:px-6 lg:px-8"
      style={{
        boxShadow: 'var(--header-shadow)',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Hamburger menu */}
        {showHamburger && (
          <button
            onClick={onToggleSidebar}
            className="flex items-center justify-center rounded-lg p-2 text-[var(--foreground-dim)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-[var(--foreground)] hover:shadow-[0_14px_30px_rgba(5,46,36,0.09)] cursor-pointer"
            aria-label={t('action.toggleSidebar')}
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
        )}

        {/* Search input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2.5 rounded-lg bg-[var(--background-secondary)] px-3.5 py-2 shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200 focus-within:-translate-y-0.5 focus-within:shadow-[0_14px_32px_rgba(5,46,36,0.1)]">
          <Search className="h-3.5 w-3.5 text-[var(--foreground-dim)]" />
          <input
            ref={searchRef}
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t('header.searchPlaceholder')}
            className="w-40 sm:w-56 bg-transparent text-[13px] text-[var(--foreground)] placeholder:text-[var(--foreground-dim)] outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md bg-[var(--background-tertiary)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--foreground-dim)]">
            /
          </kbd>
        </form>
      </div>

      {/* Right section */}
      <div className="hidden items-center gap-3 sm:flex">
        <ThemeToggle />

        {/* Notification bell replaced with "Coming soon" tooltip */}
        <Tooltip content={t('header.notificationsComingSoon')} side="bottom">
          <div className="relative flex items-center justify-center rounded-lg bg-[var(--background-secondary)] p-2.5 text-[var(--foreground-dim)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:text-[var(--foreground-muted)] hover:shadow-[0_14px_30px_rgba(5,46,36,0.09)] cursor-default opacity-60">
            <Bell className="h-4 w-4" />
          </div>
        </Tooltip>

        {/* Gateway status pill */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[var(--background-secondary)] px-3 py-1.5 shadow-[0_1px_2px_rgba(5,46,36,0.05)]">
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
            {t('header.gateway')}{' '}
            <span className="text-[var(--foreground-muted)]">
              {health?.status === 'healthy'
                ? t('status.online')
                : health?.status === 'degraded'
                  ? t('status.degraded')
                  : '...'}
            </span>
          </span>
        </div>

        {/* Logout / User avatar */}
        {authRequired ? (
          <button
            onClick={logout}
            title={t('action.signOut')}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--background-secondary)] px-3 py-1.5 text-[11px] font-medium text-[var(--foreground-dim)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_14px_30px_rgba(5,46,36,0.09)] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('action.signOut')}</span>
          </button>
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-[var(--accent-foreground)]"
            style={{
              background: 'var(--accent)',
            }}
          >
            A
          </div>
        )}
      </div>
    </header>
  )
}

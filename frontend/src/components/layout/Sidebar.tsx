import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ScrollText,
  Server,
  GitFork,
  Wallet,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHealth } from '@/hooks/use-health'
import { StatusDot } from '@/components/shared/StatusDot'

const navGroups = [
  {
    label: 'MONITOR',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/logs', icon: ScrollText, label: 'Logs' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { to: '/nodes', icon: Server, label: 'Nodes' },
      { to: '/routing', icon: GitFork, label: 'Routing' },
      { to: '/budget', icon: Wallet, label: 'Budget' },
    ],
  },
]

export function Sidebar() {
  const location = useLocation()
  const { data: health } = useHealth()

  return (
    <aside
      className="relative z-10 flex h-screen w-[240px] shrink-0 flex-col overflow-hidden"
      style={{ background: 'var(--sidebar-mesh)' }}
    >
      {/* Ambient orbs */}
      <div
        className="sidebar-orb absolute -top-20 -left-20 h-40 w-40 opacity-20"
        style={{ background: 'var(--accent)' }}
      />
      <div
        className="sidebar-orb absolute bottom-20 -right-16 h-32 w-32 opacity-10"
        style={{ background: 'var(--accent)' }}
      />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-6 py-6">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #D4A947 0%, #B8860B 100%)',
            boxShadow: '0 0 24px rgba(212, 169, 71, 0.3)',
          }}
        >
          <Zap className="h-4.5 w-4.5 text-white" />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-white/95">
            AI Gateway
          </div>
          <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-[var(--accent)]">
            Command Center
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-[var(--sidebar-border)] to-transparent" />

      {/* Navigation */}
      <nav className="relative z-10 flex-1 space-y-6 px-4 py-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-2.5 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sidebar-group-label)]">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.to)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                      isActive
                        ? 'sidebar-active bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]'
                        : 'text-stone-500 hover:bg-[var(--sidebar-hover-bg)] hover:text-stone-300'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'h-[18px] w-[18px] transition-colors',
                        isActive
                          ? 'text-[var(--accent)]'
                          : 'text-stone-600 group-hover:text-stone-400'
                      )}
                    />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-[var(--sidebar-border)] to-transparent" />

      {/* Health status footer */}
      <div className="relative z-10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <StatusDot
            status={
              health?.status === 'healthy'
                ? 'healthy'
                : health?.status === 'degraded'
                  ? 'degraded'
                  : 'unknown'
            }
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-stone-400">
              {health?.status === 'healthy'
                ? 'All Systems Online'
                : health?.status === 'degraded'
                  ? 'Degraded'
                  : 'Connecting...'}
            </div>
            {health?.uptime_human && (
              <div className="font-mono text-[9px] text-stone-600">
                {health.uptime_human}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

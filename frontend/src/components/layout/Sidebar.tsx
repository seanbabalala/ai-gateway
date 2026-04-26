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
    label: 'MONITORING',
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
      className="relative z-10 flex h-screen w-[220px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">AI Gateway</div>
          <div className="text-[10px] text-slate-400">Dashboard</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-group-label)]">
              {group.label}
            </div>
            <div className="space-y-1">
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
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150',
                      isActive
                        ? 'sidebar-active bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]'
                        : 'text-slate-400 hover:bg-[var(--sidebar-hover-bg)] hover:text-slate-200'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Health status footer */}
      <div className="border-t border-[var(--sidebar-border)] px-4 py-3">
        <div className="flex items-center gap-2">
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
            <div className="text-xs font-medium text-slate-300">
              {health?.status === 'healthy'
                ? 'All Systems OK'
                : health?.status === 'degraded'
                  ? 'Degraded'
                  : 'Connecting...'}
            </div>
            {health?.uptime_human && (
              <div className="text-[10px] text-slate-500">
                Uptime: {health.uptime_human}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

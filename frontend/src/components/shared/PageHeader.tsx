import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  badge?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, description, icon: Icon, badge, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_8px_18px_rgba(5,46,36,0.14)]"
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[30px] font-extrabold tracking-tight text-[var(--foreground)]">{title}</h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-[13px] font-medium text-[var(--foreground-dim)]">{description}</p>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>}
    </div>
  )
}

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{
          background: 'var(--accent-muted)',
          boxShadow: '0 0 32px var(--accent-glow)',
        }}
      >
        <Icon className="h-7 w-7 text-[var(--accent)]" />
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-center text-[13px] text-[var(--foreground-dim)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

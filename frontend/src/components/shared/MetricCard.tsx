import { type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
  icon?: LucideIcon
  className?: string
}

export function MetricCard({ label, value, subtitle, icon: Icon, className }: MetricCardProps) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
            {label}
          </div>
          <div className="mt-2 text-3xl font-bold text-[var(--foreground)] leading-none">
            {value}
          </div>
          {subtitle && (
            <div className="mt-1.5 text-xs text-[var(--foreground-dim)]">{subtitle}</div>
          )}
        </div>
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-muted)]">
            <Icon className="h-5 w-5 text-[var(--accent)]" />
          </div>
        )}
      </div>
    </Card>
  )
}

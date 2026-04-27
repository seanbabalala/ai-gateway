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
    <Card className={cn('animate-fade-up p-6', className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
            {label}
          </div>
          <div className="text-3xl font-bold tracking-tight text-[var(--foreground)] leading-none">
            {value}
          </div>
          {subtitle && (
            <div className="text-[11px] text-[var(--foreground-dim)]">{subtitle}</div>
          )}
        </div>
        {Icon && (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{
              background: 'var(--accent-muted)',
              boxShadow: '0 0 24px var(--accent-glow)',
            }}
          >
            <Icon className="h-5 w-5 text-[var(--accent)]" />
          </div>
        )}
      </div>
    </Card>
  )
}

import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface TrendData {
  value: number
  label: string
}

interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
  icon?: LucideIcon
  trend?: TrendData
  className?: string
}

const metricColors = ['#064B3A', '#4867E8', '#D9872F', '#7446C6']

export function MetricCard({ label, value, subtitle, icon: Icon, trend, className }: MetricCardProps) {
  const accent = metricColors[
    Math.abs(label.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % metricColors.length
  ]

  return (
    <Card className={cn('animate-fade-up relative p-5', className)}>
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="text-[11px] font-bold text-[var(--foreground-dim)]">
            {label}
          </div>
          <div className="text-[29px] font-extrabold leading-none tracking-tight text-[var(--foreground)]">
            {value}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {subtitle && (
              <span className="text-[11px] font-medium text-[var(--foreground-dim)]">{subtitle}</span>
            )}
            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                  trend.value > 0
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : trend.value < 0
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'bg-[var(--background-tertiary)] text-[var(--foreground-dim)]'
                )}
              >
                {trend.value > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : trend.value < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                {trend.value > 0 ? '+' : ''}
                {trend.value.toFixed(1)}% {trend.label}
              </span>
            )}
          </div>
        </div>
        {Icon && (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `${accent}10`,
              color: accent,
            }}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="relative mt-5 flex h-6 items-end gap-1">
        {[36, 52, 44, 62, 50, 74, 58, 66, 48].map((height, index) => (
          <div
            key={`${label}-${index}`}
            className="w-full rounded-full"
            style={{
              height: index === 5 ? `${height}%` : '3px',
              background: index === 5 ? accent : `${accent}22`,
            }}
          />
        ))}
      </div>
    </Card>
  )
}

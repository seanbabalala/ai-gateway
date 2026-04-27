import { cn } from '@/lib/utils'

interface StatusDotProps {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  size?: 'sm' | 'md'
  pulse?: boolean
}

const statusColors: Record<string, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-stone-400 dark:bg-stone-500',
}

const pulseColors: Record<string, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  unhealthy: 'bg-red-400',
  unknown: 'bg-stone-300 dark:bg-stone-400',
}

const glowColors: Record<string, string> = {
  healthy: 'shadow-[0_0_8px_rgba(16,185,129,0.4)]',
  degraded: 'shadow-[0_0_8px_rgba(245,158,11,0.4)]',
  unhealthy: 'shadow-[0_0_8px_rgba(239,68,68,0.4)]',
  unknown: '',
}

export function StatusDot({ status, size = 'md', pulse = true }: StatusDotProps) {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'

  return (
    <span className="relative inline-flex">
      {pulse && status !== 'unknown' && (
        <span
          className={cn(
            'absolute inline-flex rounded-full opacity-60 animate-pulse-dot',
            dotSize,
            pulseColors[status]
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full',
          dotSize,
          statusColors[status],
          glowColors[status]
        )}
      />
    </span>
  )
}

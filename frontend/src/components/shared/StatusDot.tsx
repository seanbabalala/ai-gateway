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
  unknown: 'bg-zinc-400 dark:bg-zinc-500',
}

const pulseColors: Record<string, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  unhealthy: 'bg-red-400',
  unknown: 'bg-zinc-300 dark:bg-zinc-400',
}

export function StatusDot({ status, size = 'md', pulse = true }: StatusDotProps) {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'

  return (
    <span className="relative inline-flex">
      {pulse && status !== 'unknown' && (
        <span
          className={cn(
            'absolute inline-flex rounded-full opacity-75 animate-pulse-dot',
            dotSize,
            pulseColors[status]
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full',
          dotSize,
          statusColors[status]
        )}
      />
    </span>
  )
}

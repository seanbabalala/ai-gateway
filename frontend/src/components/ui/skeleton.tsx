import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div className={cn('animate-shimmer rounded-lg', className)} style={style} />
  )
}

/** Matches MetricCard dimensions */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn('glass-card-static rounded-2xl p-6 space-y-3', className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-36" />
    </div>
  )
}

/** Table skeleton with configurable rows and columns */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-0', className)}>
      {/* Header */}
      <div className="flex gap-4 border-b border-[var(--border)] px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-[var(--border)] px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={`${r}-${c}`}
              className={cn('h-3 flex-1', c === 0 && 'max-w-[120px]')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Chart area placeholder */
export function SkeletonChart({
  height = 200,
  className,
}: {
  height?: number
  className?: string
}) {
  return (
    <div
      className={cn('flex items-end gap-2 px-4', className)}
      style={{ height }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className="flex-1 rounded-t-md"
          style={{
            height: `${30 + Math.random() * 60}%`,
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  )
}

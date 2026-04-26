import { type HTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[var(--background-tertiary)] text-[var(--foreground-muted)]',
        emerald:
          'bg-emerald-500/10 text-emerald-600 border border-emerald-500/15 dark:text-emerald-400',
        blue: 'bg-blue-500/10 text-blue-600 border border-blue-500/15 dark:text-blue-400',
        purple:
          'bg-purple-500/10 text-purple-600 border border-purple-500/15 dark:text-purple-400',
        pink: 'bg-pink-500/10 text-pink-600 border border-pink-500/15 dark:text-pink-400',
        amber:
          'bg-amber-500/10 text-amber-600 border border-amber-500/15 dark:text-amber-400',
        red: 'bg-red-500/10 text-red-600 border border-red-500/15 dark:text-red-400',
        zinc: 'bg-zinc-500/8 text-zinc-600 border border-zinc-500/12 dark:bg-zinc-500/12 dark:text-zinc-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        className={cn(badgeVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }

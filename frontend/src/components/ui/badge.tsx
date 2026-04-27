import { type HTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[var(--background-tertiary)] text-[var(--foreground-muted)]',
        emerald:
          'bg-emerald-500/10 text-emerald-700 border border-emerald-500/12 dark:text-emerald-400',
        blue: 'bg-sky-500/10 text-sky-700 border border-sky-500/12 dark:text-sky-400',
        purple:
          'bg-violet-500/10 text-violet-700 border border-violet-500/12 dark:text-violet-400',
        pink: 'bg-rose-500/10 text-rose-700 border border-rose-500/12 dark:text-rose-400',
        amber:
          'bg-amber-500/10 text-amber-700 border border-amber-500/12 dark:text-amber-400',
        red: 'bg-red-500/10 text-red-700 border border-red-500/12 dark:text-red-400',
        zinc: 'bg-stone-500/8 text-stone-600 border border-stone-500/10 dark:bg-stone-500/12 dark:text-stone-400',
        gold: 'bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)]/15',
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

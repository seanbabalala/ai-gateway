import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-3.5 py-1 text-[13px] text-[var(--foreground)] shadow-sm transition-all duration-200',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-[var(--foreground-dim)]',
          'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)] focus:shadow-[0_0_0_3px_var(--accent-muted)]',
          'hover:border-[var(--border-hover)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }

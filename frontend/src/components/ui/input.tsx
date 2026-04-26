import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 text-sm text-[var(--foreground)] shadow-sm transition-colors duration-150',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-[var(--foreground-dim)]',
          'focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]',
          'hover:border-[var(--border-hover)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
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

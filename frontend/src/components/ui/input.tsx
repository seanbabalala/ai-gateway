import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg bg-[var(--background-secondary)] px-3.5 py-1 text-[13px] text-[var(--foreground)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-[var(--foreground-dim)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]',
          'hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,46,36,0.09)]',
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

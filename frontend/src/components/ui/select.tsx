import { type SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-3.5 py-1 text-[13px] text-[var(--foreground)] transition-all duration-200',
          'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]',
          'hover:border-[var(--border-hover)]',
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" className="text-[var(--foreground-dim)]">
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }
)
Select.displayName = 'Select'

export { Select }

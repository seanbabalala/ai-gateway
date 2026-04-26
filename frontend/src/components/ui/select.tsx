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
          'h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 text-sm text-[var(--foreground)] transition-colors duration-150',
          'focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]',
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

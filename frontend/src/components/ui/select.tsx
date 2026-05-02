import { type SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { CustomSelect } from './custom-select'

// Re-export CustomSelect as the default Select
export { CustomSelect as Select }
export type { SelectOption } from './custom-select'

// Keep native select available for forms that need it (e.g. within NodeFormModal internal selects)
export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, options, placeholder, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9 w-full rounded-lg bg-[var(--background-secondary)] px-3.5 py-1 text-[13px] text-[var(--foreground)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]',
          'hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,46,36,0.09)]',
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
NativeSelect.displayName = 'NativeSelect'

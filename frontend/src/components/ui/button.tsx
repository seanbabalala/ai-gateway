import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_4px_12px_rgba(5,46,36,0.12)] hover:-translate-y-0.5 hover:bg-[var(--accent-hover)] hover:shadow-[0_16px_34px_rgba(5,46,36,0.22)] active:scale-[0.98]',
        destructive:
          'bg-red-600 text-white shadow-[0_10px_24px_rgba(220,38,38,0.18)] hover:bg-red-700 active:scale-[0.98]',
        outline:
          'bg-[var(--background-secondary)] text-[var(--foreground-muted)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_14px_32px_rgba(5,46,36,0.1)]',
        secondary:
          'bg-[var(--background-tertiary)] text-[var(--foreground-muted)] hover:bg-[var(--accent-muted)] hover:text-[var(--foreground)]',
        ghost:
          'text-[var(--foreground-dim)] hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]',
        link: 'text-[var(--accent)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-lg px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }

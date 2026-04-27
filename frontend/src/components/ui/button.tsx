import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.2),0_0_24px_var(--accent-glow)] active:scale-[0.98]',
        destructive:
          'bg-gradient-to-b from-red-600 to-red-700 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.2)] active:scale-[0.98]',
        outline:
          'border border-[var(--border)] bg-[var(--glass-bg)] text-[var(--foreground-muted)] backdrop-blur-sm hover:bg-[var(--background-tertiary)] hover:text-[var(--foreground)] hover:border-[var(--border-hover)]',
        secondary:
          'bg-[var(--background-tertiary)] text-[var(--foreground-muted)] hover:bg-[var(--border-hover)] hover:text-[var(--foreground)]',
        ghost:
          'text-[var(--foreground-dim)] hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]',
        link: 'text-[var(--accent)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-xl px-6',
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

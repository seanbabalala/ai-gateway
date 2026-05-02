import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  error?: Error | { message?: string } | null
  onRetry?: () => void
  className?: string
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation('common')
  const message =
    (error as Error)?.message || t('error.generic')

  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10"
        style={{ boxShadow: '0 0 32px rgba(229, 91, 80, 0.15)' }}
      >
        <AlertTriangle className="h-7 w-7 text-red-500" />
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
        {t('error.failedToLoad')}
      </h3>
      <p className="mt-1.5 max-w-sm text-center text-[13px] text-[var(--foreground-dim)]">
        {message}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          {t('action.retry')}
        </Button>
      )}
    </div>
  )
}

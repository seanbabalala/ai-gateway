import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import type { ReactNode } from 'react'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const { token, authRequired, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <span className="text-sm text-[var(--foreground-dim)]">{t('status.loading')}</span>
        </div>
      </div>
    )
  }

  if (authRequired && !token) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

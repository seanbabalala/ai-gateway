import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export function LoginPage() {
  const { t } = useTranslation('login')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(password)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message || t('login.errorFallback'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] p-4">
      <div className="app-grid-bg pointer-events-none absolute inset-0" />
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-muted)] shadow-lg">
              <Shield className="h-6 w-6 text-[var(--accent)]" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-[var(--foreground)]">
                {t('login.title')}
              </h1>
              <p className="mt-1 text-[13px] text-[var(--foreground-dim)]">
                {t('login.subtitle')}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Input
                type="password"
                placeholder={t('login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading || !password}>
              {loading ? t('login.signingIn') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

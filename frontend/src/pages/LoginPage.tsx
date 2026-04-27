import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export function LoginPage() {
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
      setError((err as Error).message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] shadow-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-[var(--foreground)]">
                AI Gateway
              </h1>
              <p className="mt-1 text-[13px] text-[var(--foreground-dim)]">
                Enter your password to access the dashboard
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Input
                type="password"
                placeholder="Password"
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
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

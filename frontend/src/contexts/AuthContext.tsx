import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { i18n } from '@/i18n'

interface AuthContextValue {
  token: string | null
  authRequired: boolean
  authenticated: boolean
  localLoginEnabled: boolean
  oidc: {
    enabled: boolean
    issuer: string | null
    client_id: string | null
    scopes: string[]
  }
  loading: boolean
  login: (password: string, invite?: string | null) => Promise<void>
  completeLogin: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'siftgate-token'

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAuthToken())
  const [authRequired, setAuthRequired] = useState(true)
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false)
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false)
  const [oidc, setOidc] = useState<AuthContextValue['oidc']>({
    enabled: false,
    issuer: null,
    client_id: null,
    scopes: [],
  })
  const [loading, setLoading] = useState(true)

  // Check auth status on mount
  useEffect(() => {
    let cancelled = false

    async function checkStatus() {
      try {
        const res = await fetch('/api/auth/status', { credentials: 'same-origin' })
        if (!res.ok) throw new Error(i18n.t('login:login.authStatusError'))
        const data = (await res.json()) as {
          authRequired: boolean
          authenticated?: boolean
          localLoginEnabled?: boolean
          oidc?: AuthContextValue['oidc']
        }
        if (!cancelled) {
          setAuthRequired(data.authRequired)
          setSessionAuthenticated(Boolean(data.authenticated))
          setLocalLoginEnabled(data.localLoginEnabled ?? data.authRequired)
          setOidc(data.oidc ?? {
            enabled: false,
            issuer: null,
            client_id: null,
            scopes: [],
          })
        }
      } catch {
        // If auth status is unavailable, keep protected routes closed.
        if (!cancelled) {
          setAuthRequired(true)
          setSessionAuthenticated(false)
          setLocalLoginEnabled(true)
          setOidc({ enabled: false, issuer: null, client_id: null, scopes: [] })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    checkStatus()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (password: string, invite?: string | null) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, invite: invite || undefined }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: i18n.t('login:login.errorFallback') }))
      throw new Error(data.message || i18n.t('login:login.invalidPassword'))
    }

    const data = (await res.json()) as { token: string }
    setAuthToken(data.token)
    setToken(data.token)
    setSessionAuthenticated(true)
  }, [])

  const completeLogin = useCallback((nextToken: string) => {
    setAuthToken(nextToken)
    setToken(nextToken)
    setSessionAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    clearAuthToken()
    setToken(null)
    setSessionAuthenticated(false)
    void fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => undefined)
  }, [])

  const authenticated = !authRequired || sessionAuthenticated || Boolean(token)

  return (
    <AuthContext.Provider value={{ token, authRequired, authenticated, localLoginEnabled, oidc, loading, login, completeLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

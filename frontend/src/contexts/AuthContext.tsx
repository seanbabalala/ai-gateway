import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

interface AuthContextValue {
  token: string | null
  authRequired: boolean
  loading: boolean
  login: (password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'ai-gateway-token'

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
  const [authRequired, setAuthRequired] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check auth status on mount
  useEffect(() => {
    let cancelled = false

    async function checkStatus() {
      try {
        const res = await fetch('/api/auth/status')
        if (!res.ok) throw new Error('Failed to check auth status')
        const data = (await res.json()) as { authRequired: boolean }
        if (!cancelled) {
          setAuthRequired(data.authRequired)
        }
      } catch {
        // If we can't reach the server, assume no auth required
        if (!cancelled) {
          setAuthRequired(false)
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

  const login = useCallback(async (password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Login failed' }))
      throw new Error(data.message || 'Invalid password')
    }

    const data = (await res.json()) as { token: string }
    setAuthToken(data.token)
    setToken(data.token)
  }, [])

  const logout = useCallback(() => {
    clearAuthToken()
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, authRequired, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

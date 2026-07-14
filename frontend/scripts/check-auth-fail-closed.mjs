import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const authContextPath = fileURLToPath(new URL('../src/contexts/AuthContext.tsx', import.meta.url))
const source = readFileSync(authContextPath, 'utf8')

assert(
  source.includes('const [authRequired, setAuthRequired] = useState(true)'),
  'AuthContext must default authRequired to true so protected routes fail closed before status loads.',
)

assert(
  source.includes('setAuthRequired(true)') && source.includes('setLocalLoginEnabled(true)'),
  'AuthContext status failure path must keep auth required and show the local login fallback.',
)

assert(
  !source.includes('assume no auth required') && !source.includes('setAuthRequired(false)\\n          setLocalLoginEnabled(false)'),
  'AuthContext must not fail open when /api/auth/status is unavailable.',
)

console.log('Dashboard auth status fail-closed behavior validated.')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

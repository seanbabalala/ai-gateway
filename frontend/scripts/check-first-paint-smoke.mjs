import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const app = read('src/App.tsx')
const dashboardPage = read('src/pages/DashboardPage.tsx')
const skeleton = read('src/components/ui/skeleton.tsx')

assert(
  packageJson.scripts.build.includes('npm run bundle:check'),
  'frontend build must keep the bundle budget gate after Vite build.',
)

for (const token of [
  'lazy, Suspense',
  'function RouteFallback()',
  'function LoginRouteFallback()',
  'role="status"',
  'aria-live="polite"',
  'aria-busy="true"',
  "t('status.loading')",
  '<SkeletonCard',
  '<SkeletonTable rows={5} cols={5}',
  '<Suspense fallback={fallback}>',
  '<Route path="/login" element={page(<LoginPage />, <LoginRouteFallback />)} />',
]) {
  assert(app.includes(token), `Dashboard route first-paint fallback is missing ${token}.`)
}

for (const token of [
  'if (isLoading || !stats)',
  '<PageHeader title={t(',
  '<SkeletonCard',
  '<SkeletonChart height={200}',
]) {
  assert(dashboardPage.includes(token), `Dashboard data-loading skeleton is missing ${token}.`)
}

assert(
  skeleton.includes('const chartSkeletonBars') &&
    skeleton.includes('chartSkeletonBars[i % chartSkeletonBars.length]'),
  'SkeletonChart must use stable deterministic bar heights.',
)

assert(
  !skeleton.includes('Math.random'),
  'SkeletonChart must not randomize first-paint placeholder layout.',
)

console.log('Dashboard first-paint smoke validated: route skeletons, login fallback, stable chart placeholders, and bundle budget gate are present.')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

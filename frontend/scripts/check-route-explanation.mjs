import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8')

const app = read('src/App.tsx')
const hook = read('src/hooks/use-route-decisions.ts')
const page = read('src/pages/RouteExplanationPage.tsx')
const logs = read('src/pages/LogsPage.tsx')

for (const route of [
  '<Route path="/route-decisions"',
  '<Route path="/route-decisions/:requestId"',
]) {
  if (!app.includes(route)) {
    throw new Error(`Missing Dashboard route: ${route}`)
  }
}

for (const endpoint of [
  '/api/dashboard/route-decisions',
  '/api/dashboard/route-decisions/',
]) {
  if (!hook.includes(endpoint)) {
    throw new Error(`Route decision hook must call ${endpoint}`)
  }
}

if (!logs.includes('/route-decisions/${encodeURIComponent(log.request_id)}')) {
  throw new Error('Logs detail row must link to the matching route decision.')
}

for (const forbidden of ['apiPost', 'apiPut', 'apiDelete', 'updateRouting', 'config/reload']) {
  if (page.includes(forbidden)) {
    throw new Error(`Route Explanation page must stay read-only; found ${forbidden}.`)
  }
}

for (const key of [
  "t('routeExplanation.empty.noTraceTitle')",
  "t('routeExplanation.empty.noDecisionsTitle')",
  "t('routeExplanation.sections.modalityEvidence')",
  "t('routeExplanation.sections.compatibilityEvidence')",
  "t('routeExplanation.sections.cacheEvidence')",
  "t('routeExplanation.table.capability')",
  "t('routeExplanation.table.cache')",
]) {
  if (!page.includes(key)) {
    throw new Error(`Route Explanation page must keep localized empty/no-trace compatibility state: ${key}`)
  }
}

for (const field of [
  'trace.modality_evidence',
  'trace.cache_evidence',
  'candidate.capability_evidence',
  'candidate.cache_evidence',
  'candidate.compatibility_evidence',
  'compatibility_profile',
  'filtered_by_profile_reason',
  'pricing_source',
  'catalog_source',
  'endpoint_status',
]) {
  if (!page.includes(field)) {
    throw new Error(`Route Explanation page must render multimodal routing evidence field: ${field}`)
  }
}

console.log('Open-source Dashboard route explanation validated: routes, hooks, log deep link, multimodal evidence, and read-only page are present.')

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8')

const hook = read('src/hooks/use-shadow.ts')
const page = read('src/pages/ShadowPage.tsx')
const types = read('src/types/api.ts')

for (const endpoint of [
  '/api/dashboard/shadow/report',
  '/api/dashboard/shadow/results/',
  '/comparison',
]) {
  if (!hook.includes(endpoint)) {
    throw new Error(`Shadow hooks must call ${endpoint}`)
  }
}

for (const field of [
  'primary_success_rate',
  'shadow_success_rate',
  'latency_delta_ms',
  'p50_latency_comparison',
  'p95_latency_comparison',
  'cost_delta_usd',
  'potential_savings_usd',
  'token_delta',
  'fallback_delta',
  'quality_sample_coverage',
  'confidence',
  'risk_notes',
]) {
  if (!types.includes(field)) {
    throw new Error(`Shadow report API type is missing ${field}`)
  }
}

for (const key of [
  "t('shadow.readOnly')",
  "t('shadow.filters.title')",
  "t('shadow.report.title')",
  "t('shadow.privacyWarningTitle')",
]) {
  if (!page.includes(key)) {
    throw new Error(`Shadow report page must render localized key ${key}`)
  }
}

for (const forbidden of ['apiPost', 'apiPut', 'apiDelete', 'updateRouting']) {
  if (page.includes(forbidden)) {
    throw new Error(`Shadow comparison report must stay read-only; found ${forbidden}.`)
  }
}

console.log('Open-source Dashboard shadow comparison validated: hooks, report fields, localized copy, and read-only page are present.')

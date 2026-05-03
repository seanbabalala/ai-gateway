import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const shadowPage = readFileSync(join(root, 'src/pages/ShadowPage.tsx'), 'utf8')
const apiTypes = readFileSync(join(root, 'src/types/api.ts'), 'utf8')

for (const needle of [
  'shadow.report.title',
  'shadow.report.recommendation',
  'shadow.report.quality',
  'report.recommendation.decision',
  'formatDeltaCost(report.cost.delta_usd)',
]) {
  if (!shadowPage.includes(needle)) {
    throw new Error(`Shadow comparison page is missing: ${needle}`)
  }
}

for (const needle of [
  'ShadowTrafficComparisonReport',
  'primary_cost_usd',
  'shadow_cost_usd',
  'primary_response_sample',
  'report: ShadowTrafficComparisonReport',
]) {
  if (!apiTypes.includes(needle)) {
    throw new Error(`Shadow comparison API type is missing: ${needle}`)
  }
}

if (/fetch\(|apiPost|apiPut|apiDelete/.test(shadowPage)) {
  throw new Error('Shadow comparison page must stay read-only.')
}

console.log('Open-source Dashboard shadow comparison validated: read-only report UI and API types are present.')

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8')

const hook = read('src/hooks/use-guardrails.ts')
const dashboard = read('src/pages/DashboardPage.tsx')
const types = read('src/types/api.ts')

if (!hook.includes('/api/dashboard/guardrails')) {
  throw new Error('Guardrails hook must call /api/dashboard/guardrails.')
}

for (const field of [
  'GuardrailsResponse',
  'GuardrailFindingSummary',
  'GuardrailsWebhookStatus',
  'media_bytes: false',
]) {
  if (!types.includes(field)) {
    throw new Error(`Guardrails API type must include ${field}.`)
  }
}

for (const token of [
  'useGuardrails',
  "t('guardrails.title')",
  "t('guardrails.findings')",
  "t('guardrails.webhook')",
  "t('guardrails.lastWebhookError')",
]) {
  if (!dashboard.includes(token)) {
    throw new Error(`Dashboard Guardrails summary is missing ${token}.`)
  }
}

for (const forbidden of ['apiPost', 'apiPut', 'apiDelete', 'webhook.url', 'webhook.headers']) {
  if (dashboard.includes(forbidden)) {
    throw new Error(`Guardrails Dashboard summary must stay read-only and secret-safe; found ${forbidden}.`)
  }
}

console.log('Open-source Dashboard guardrails summary validated: hook, API types, localized card, and read-only privacy constraints are present.')

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8')
const sidebar = readFileSync(fileURLToPath(new URL('../src/components/layout/Sidebar.tsx', import.meta.url)), 'utf8')
const page = readFileSync(fileURLToPath(new URL('../src/pages/ProviderCatalogPage.tsx', import.meta.url)), 'utf8')
const apiTypes = readFileSync(fileURLToPath(new URL('../src/types/api.ts', import.meta.url)), 'utf8')
const enNodes = readFileSync(fileURLToPath(new URL('../src/locales/en/nodes.json', import.meta.url)), 'utf8')

if (!app.includes('ProviderCatalogPage') || !app.includes('path="/catalog"')) {
  throw new Error('Provider Catalog page must be mounted at /catalog.')
}

if (!sidebar.includes("labelKey: 'nav.catalog'") || !sidebar.includes("to: '/catalog'")) {
  throw new Error('Provider Catalog page must be reachable from the sidebar.')
}

for (const expected of [
  'pricing_hygiene',
  'pricing_confidence',
  'stale_after_days',
  'source_url',
  'catalogPage.status.stale',
  'catalogPage.sources.openrouterApi',
  'catalogPage.confidenceLevels.high',
  'catalogPage.refreshSources.title',
  'catalogPage.refreshSources.modes.operator_local',
  'catalogPage.sync.title',
  'catalogPage.sync.status.fresh',
  'sync_status',
  'CatalogSyncStatus',
  'compatibility_profiles',
  'ProviderCompatibilityProfile',
  'catalogPage.metrics.compatibilityProfiles',
]) {
  if (!page.includes(expected) && !apiTypes.includes(expected) && !enNodes.includes(expected)) {
    throw new Error(`Provider Catalog price source status marker missing: ${expected}`)
  }
}

if (enNodes.includes('Pricing hygiene')) {
  throw new Error('Provider Catalog page copy should use pricing source/status wording, not "pricing hygiene".')
}

console.log('Open-source Dashboard Provider Catalog source status page validated.')

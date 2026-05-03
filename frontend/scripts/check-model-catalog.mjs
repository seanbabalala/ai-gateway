import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8')

const app = read('src/App.tsx')
const hook = read('src/hooks/use-model-catalog.ts')
const page = read('src/pages/ModelCatalogPage.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')

if (!app.includes('<Route path="/model-catalog"')) {
  throw new Error('Missing Dashboard route: /model-catalog')
}

if (!sidebar.includes("to: '/model-catalog'")) {
  throw new Error('Sidebar must link to the Model Catalog page.')
}

if (!hook.includes('/api/dashboard/model-catalog')) {
  throw new Error('Model catalog hook must call /api/dashboard/model-catalog')
}

for (const forbidden of ['apiPost', 'apiPut', 'apiDelete', 'updateRouting', 'config/reload']) {
  if (page.includes(forbidden)) {
    throw new Error(`Model Catalog page must stay read-only; found ${forbidden}.`)
  }
}

for (const key of [
  "t('modelCatalog.title')",
  "t('modelCatalog.empty.title')",
  "t('modelCatalog.footer')",
]) {
  if (!page.includes(key)) {
    throw new Error(`Model Catalog page must keep localized UX key: ${key}`)
  }
}

console.log('Open-source Dashboard model catalog validated: route, hook, nav, and read-only page are present.')

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const page = readFileSync(join(root, 'src/pages/BudgetPage.tsx'), 'utf8')
const hook = readFileSync(join(root, 'src/hooks/use-budget.ts'), 'utf8')
const apiTypes = readFileSync(join(root, 'src/types/api.ts'), 'utf8')
const packageJson = readFileSync(join(root, 'package.json'), 'utf8')
const locales = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'th', 'es']
const requiredLocaleKeys = [
  'budget.title',
  'budget.description',
  'scopeSource.title',
  'scopeSource.source',
  'scopeSource.globalReadOnly',
  'scopeKinds.global',
  'scopeKinds.namespace',
  'scopeKinds.team',
  'scopeKinds.api_key',
  'source.globalConfig',
  'source.namespaceConfig',
  'source.teamPolicy',
  'source.apiKeyPolicy',
  'status.inherited',
  'status.unset',
  'chain.title',
  'rules.noScopeTitle',
  'rules.table.source',
  'edit.notes.namespace',
  'edit.notes.team',
  'edit.notes.api_key',
]

for (const snippet of [
  'useNamespaces',
  'useTeams',
  'useUpdateNamespace',
  'useUpdateTeam',
  'useUpdateGatewayApiKey',
  'ScopeSourceCard',
  'EnforcementChain',
  "selectedScope.kind === 'namespace'",
  "selectedScope.kind === 'team'",
  "selectedScope.kind === 'api_key'",
  "selectedOption.scope.kind === 'global'",
]) {
  assert(page.includes(snippet), `BudgetPage is missing ${snippet}`)
}

for (const snippet of [
  "kind?: 'global' | 'namespace' | 'team' | 'api_key'",
  "namespace: scope?.id || scope?.name",
  "team_id: scope?.id",
  "api_key_id: scope?.id",
  'parseBudgetScopeKey',
]) {
  assert(hook.includes(snippet), `budget hook is missing ${snippet}`)
}

for (const snippet of [
  'sourceOfTruth',
  'editableVia',
  'selectedScope',
  'scopeChain',
  'namespaceRules?: BudgetRule[]',
  'teamRules?: BudgetRule[]',
  'perKeyRules?: BudgetRule[]',
]) {
  assert(apiTypes.includes(snippet), `budget API types are missing ${snippet}`)
}

assert(packageJson.includes('budget-scopes:check'), 'frontend test script must include budget-scopes:check.')

for (const locale of locales) {
  const value = JSON.parse(readFileSync(join(root, 'src/locales', locale, 'budget.json'), 'utf8'))
  for (const key of requiredLocaleKeys) {
    assert(readPath(value, key), `${locale}/budget.json missing ${key}`)
  }
}

console.log('Budget scope checks passed: scope selector, metadata types, safe edit paths, and 7-language locale keys are present.')

function readPath(value, path) {
  if (Object.prototype.hasOwnProperty.call(value, path)) {
    return value[path]
  }
  return path.split('.').reduce((current, key) => current?.[key], value)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const page = read('src/pages/DashboardPage.tsx')
const docs = read('src/components/shared/DocsLinkGroup.tsx')
const packageJson = read('package.json')

for (const snippet of [
  "key: 'workspace'",
  "key: 'provider'",
  "key: 'key'",
  "key: 'namespace'",
  "key: 'budget'",
  "key: 'request'",
  "key: 'evidence'",
  "key: 'advanced'",
  "href: '/workspaces'",
  "href: '/nodes'",
  "href: '/api-keys'",
  "href: '/namespaces'",
  "href: '/budget'",
  "href: '/playground'",
  "href: '/logs'",
  "href: '/semantic-platform'",
  'requiredFirstRunSteps',
  'isFirstRunComplete',
  'onboardingCollapsed',
  'ONBOARDING_VISIBILITY_STORAGE_KEY',
  'readOnboardingVisibilityPreference',
  'writeOnboardingVisibilityPreference(nextVisibility)',
  "useState<OnboardingVisibility | null>(() => readOnboardingVisibilityPreference())",
  'onboarding.actions.showChecklist',
  'onboarding.actions.hideChecklist',
  'onboarding.status.optional',
  'onboarding.docs.quickstart',
  'docs/OSS_CONCEPTS.md',
]) {
  assert(page.includes(snippet), `Dashboard onboarding is missing ${snippet}`)
}

for (const snippet of [
  'REPO_DOCS_BASE_URL',
  'target="_blank"',
  'rel="noreferrer"',
  'docs.title',
  'docs.description',
]) {
  assert(docs.includes(snippet), `DocsLinkGroup is missing ${snippet}`)
}

assert(packageJson.includes('onboarding:check'), 'frontend test script must include onboarding:check.')

const locales = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'th', 'es']
const dashboardKeys = [
  'onboarding.actions.reviewAdvanced',
  'onboarding.actions.reviewBudget',
  'onboarding.actions.reviewNamespaces',
  'onboarding.actions.hideChecklist',
  'onboarding.actions.showChecklist',
  'onboarding.docs.quickstart',
  'onboarding.docs.concepts',
  'onboarding.docs.dashboard',
  'onboarding.docs.providers',
  'onboarding.docs.namespaces',
  'onboarding.docs.advanced',
  'onboarding.status.optional',
  'onboarding.summary.complete',
  'onboarding.summary.next',
  'onboarding.steps.namespace.title',
  'onboarding.steps.namespace.description',
  'onboarding.steps.budget.title',
  'onboarding.steps.budget.description',
  'onboarding.steps.advanced.title',
  'onboarding.steps.advanced.description',
  'semanticPlatform.docs.semantic',
  'evals.docs.framework',
  'shadow.docs.namespaceShadow',
  'mcp.docs.gateway',
]
const commonKeys = [
  'docs.title',
  'docs.description',
  'workspaces.docs.concepts',
  'namespaces.docs.namespaceShadow',
]
const localizedPrivacyTerms = {
  en: ['prompts', 'responses', 'resolved secrets'],
  zh: ['提示词', '响应', '解析后的密钥'],
  'zh-TW': ['提示詞', '回應', '解析後的密鑰'],
  ja: ['プロンプト', '応答', 'シークレット'],
  ko: ['프롬프트', '응답', '비밀'],
  th: ['พรอมป์', 'คำตอบ', 'ความลับที่ถูกคลี่ออก'],
  es: ['instrucciones', 'respuestas', 'secretos resueltos'],
}

for (const locale of locales) {
  const dashboard = JSON.parse(read(`src/locales/${locale}/dashboard.json`))
  const common = JSON.parse(read(`src/locales/${locale}/common.json`))
  const nodes = JSON.parse(read(`src/locales/${locale}/nodes.json`))
  const budget = JSON.parse(read(`src/locales/${locale}/budget.json`))
  const analytics = JSON.parse(read(`src/locales/${locale}/analytics.json`))
  const apiKeys = JSON.parse(read(`src/locales/${locale}/apiKeys.json`))

  for (const key of dashboardKeys) assert(readPath(dashboard, key), `${locale}/dashboard.json missing ${key}`)
  for (const key of commonKeys) assert(readPath(common, key), `${locale}/common.json missing ${key}`)
  for (const key of ['catalogPage.docs.catalog', 'nodes.docs.providerCatalog']) {
    assert(readPath(nodes, key), `${locale}/nodes.json missing ${key}`)
  }
  for (const key of ['budget.docs.api', 'budget.docs.concepts']) {
    assert(readPath(budget, key), `${locale}/budget.json missing ${key}`)
  }
  for (const key of ['experiments.docs.api', 'experiments.docs.evals']) {
    assert(readPath(analytics, key), `${locale}/analytics.json missing ${key}`)
  }
  for (const key of ['docs.apiKeys', 'docs.policyNamespaces']) {
    assert(readPath(apiKeys, key), `${locale}/apiKeys.json missing ${key}`)
  }

  for (const term of localizedPrivacyTerms[locale]) {
    assert(
      dashboard['onboarding.privacy']?.includes(term),
      `${locale}/dashboard.json onboarding privacy must keep localized storage boundary term ${term}.`,
    )
  }
}

console.log('Dashboard onboarding checks passed: end-to-end setup path, docs links, privacy copy, and 7-language locale keys are present.')

function readPath(value, path) {
  if (Object.prototype.hasOwnProperty.call(value, path)) {
    return value[path]
  }
  return path.split('.').reduce((current, key) => current?.[key], value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'src/pages/ApiKeysPage.tsx'), 'utf8')
const packageJson = readFileSync(join(root, 'package.json'), 'utf8')
const locales = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'th', 'es']
const requiredLocaleKeys = [
  'form.allowedEndpoints',
  'form.allowedModalities',
  'permissions.endpoints_one',
  'permissions.endpoints_other',
  'permissions.modalities_one',
  'permissions.modalities_other',
  'summary.errorRate',
  'table.masked',
  'table.errorRate',
  'endpoints.images',
  'endpoints.audio',
  'endpoints.video',
  'endpoints.realtime',
  'endpoints.batch',
  'modalities.vision',
  'modalities.image',
  'modalities.audio',
  'modalities.video',
]

for (const snippet of [
  'allowed_endpoints',
  'allowed_modalities',
  'API_KEY_ENDPOINTS',
  'API_KEY_MODALITIES',
  "t('table.masked')",
  "t('summary.errorRate')",
  'CreatedKeyDialog',
  'plainKey',
  'navigator.clipboard.writeText(plainKey)',
  'nodeModelBuckets',
]) {
  assert(source.includes(snippet), `ApiKeysPage is missing ${snippet}`)
}

assert(
  source.includes('key.key_prefix') && !source.includes('key.key_hash'),
  'API key table must render the masked prefix only, never key_hash.',
)
assert(
  !source.includes('key.key}') && !source.includes('key.key '),
  'API key list rows must not render a stored plaintext key.',
)
assert(
  packageJson.includes('api-keys:check'),
  'frontend test script must include api-keys:check.',
)

for (const locale of locales) {
  const value = JSON.parse(readFileSync(join(root, 'src/locales', locale, 'apiKeys.json'), 'utf8'))
  for (const key of requiredLocaleKeys) {
    assert(readPath(value, key), `${locale}/apiKeys.json missing ${key}`)
  }
}

console.log('API key Dashboard checks passed: endpoint/modality controls, masked table values, one-time copy dialog, and 7-language locale keys.')

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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const localesRoot = join(root, 'src/locales')
const baseLocale = 'en'
const translatedLocales = ['zh', 'zh-TW', 'ja', 'ko', 'th', 'es']
const namespaces = [
  'common',
  'dashboard',
  'logs',
  'nodes',
  'routing',
  'budget',
  'analytics',
  'apiKeys',
  'login',
]

for (const namespace of namespaces) {
  const value = readLocaleJson(baseLocale, namespace)
  const keys = flattenKeys(value)

  for (const key of keys) {
    if (typeof readPath(value, key) !== 'string') {
      throw new Error(`${baseLocale}/${namespace}.json contains a non-string leaf at ${key}`)
    }
  }

  for (const locale of translatedLocales) {
    const translated = readLocaleJson(locale, namespace)
    const translatedKeys = flattenKeys(translated)

    for (const key of translatedKeys) {
      if (typeof readPath(translated, key) !== 'string') {
        throw new Error(`${locale}/${namespace}.json contains a non-string leaf at ${key}`)
      }
    }

    assertSameKeys(`${baseLocale}/${namespace}.json`, keys, `${locale}/${namespace}.json`, translatedKeys)
  }
}

const allLocaleKeys = new Set(
  namespaces.flatMap((namespace) => flattenKeys(readLocaleJson(baseLocale, namespace))),
)
const usedLiteralKeys = collectUsedLiteralKeys(join(root, 'src'))
const missing = usedLiteralKeys.filter((key) => !hasLocaleKey(allLocaleKeys, key))
const languageSwitcherSource = readFileSync(
  join(root, 'src/components/i18n/LanguageSwitcher.tsx'),
  'utf8',
)

if (missing.length > 0) {
  throw new Error(`Missing English i18n keys:\n${missing.map((key) => `  - ${key}`).join('\n')}`)
}

validateLanguageSwitcher(languageSwitcherSource)

console.log(
  `Open-source Dashboard i18n validated: ${[baseLocale, ...translatedLocales].join(', ')} locales, ${namespaces.length} namespaces, ${usedLiteralKeys.length} literal keys.`,
)

function readLocaleJson(locale, namespace) {
  const filePath = join(localesRoot, locale, `${namespace}.json`)

  if (!existsSync(filePath)) {
    throw new Error(`Missing locale file: ${filePath}`)
  }

  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function flattenKeys(value, prefix = '') {
  return Object.entries(value)
    .flatMap(([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key

      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return flattenKeys(nested, path)
      }

      return [path]
    })
    .sort()
}

function readPath(value, path) {
  if (Object.prototype.hasOwnProperty.call(value, path)) {
    return value[path]
  }

  return path.split('.').reduce((current, key) => current?.[key], value)
}

function hasLocaleKey(keys, key) {
  if (key.includes(':')) {
    return hasLocaleKey(keys, key.split(':').slice(1).join(':'))
  }

  return keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`)
}

function collectUsedLiteralKeys(srcRoot) {
  const files = walk(srcRoot).filter((filePath) => /\.(ts|tsx)$/.test(filePath))
  const keys = new Set()
  const pattern = /\bt\(\s*['"]([^'"]+)['"]/g

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8')
    for (const match of source.matchAll(pattern)) {
      keys.add(match[1])
    }
  }

  return Array.from(keys).sort()
}

function validateLanguageSwitcher(source) {
  for (const languageName of [
    'English',
    '简体中文',
    '繁體中文',
    '日本語',
    '한국어',
    'ไทย',
    'Español',
  ]) {
    if (!readFileSync(join(root, 'src/i18n.ts'), 'utf8').includes(`name: '${languageName}'`)) {
      throw new Error(`Missing supported language label: ${languageName}`)
    }
  }

  if (!source.includes('localStorage.setItem(localeStorageKey, locale)')) {
    throw new Error('LanguageSwitcher must persist selections to localStorage.')
  }

  if (!source.includes('role="menu"') || !source.includes('role="menuitemradio"')) {
    throw new Error('LanguageSwitcher must expose the language list as an accessible menu.')
  }

  if (source.includes('<select')) {
    throw new Error('LanguageSwitcher should use the unified click-to-expand menu, not <select>.')
  }
}

function assertSameKeys(baseLabel, baseKeys, translatedLabel, translatedKeys) {
  const baseSet = new Set(baseKeys)
  const translatedSet = new Set(translatedKeys)
  const missing = baseKeys.filter((key) => !translatedSet.has(key))
  const extra = translatedKeys.filter((key) => !baseSet.has(key))

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      [
        `${translatedLabel} keys do not match ${baseLabel}.`,
        missing.length > 0 ? `Missing:\n${missing.map((key) => `  - ${key}`).join('\n')}` : '',
        extra.length > 0 ? `Extra:\n${extra.map((key) => `  - ${key}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const filePath = join(dir, entry)
    const stats = statSync(filePath)
    return stats.isDirectory() ? walk(filePath) : [filePath]
  })
}

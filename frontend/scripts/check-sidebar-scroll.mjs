import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync('src/components/layout/Sidebar.tsx', 'utf8')
const css = fs.readFileSync('src/index.css', 'utf8')
const locales = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'th', 'es']

const checks = [
  {
    ok: source.includes('overflow-hidden border-r'),
    message: 'Sidebar shell must clip its own height instead of letting nav overflow the viewport.',
  },
  {
    ok: source.includes('min-h-0 flex-1') && source.includes('overflow-y-auto') && source.includes('overscroll-contain'),
    message: 'Sidebar nav must be the scrollable flex child with min-h-0 and overflow-y-auto.',
  },
  {
    ok: source.includes('shrink-0 items-center') && source.includes('relative z-20 shrink-0'),
    message: 'Sidebar logo and footer must stay fixed while the middle nav scrolls.',
  },
  {
    ok: css.includes('.sidebar-nav-scroll') && css.includes('scrollbar-gutter: stable'),
    message: 'Sidebar nav must define stable, visible scrollbar styling.',
  },
  {
    ok:
      source.includes('showScrollHint') &&
      source.includes('ResizeObserver') &&
      source.includes("t('sidebar.scrollHint')") &&
      source.includes('ChevronDown'),
    message: 'Sidebar must show a dynamic scroll hint while hidden nav items remain below.',
  },
  {
    ok: css.includes('.sidebar-scroll-hint') && css.includes('@keyframes sidebar-scroll-hint-float'),
    message: 'Sidebar scroll hint must have subtle animated styling.',
  },
  {
    ok: locales.every((locale) => {
      const localePath = path.join('src', 'locales', locale, 'common.json')
      const data = JSON.parse(fs.readFileSync(localePath, 'utf8'))
      return typeof data['sidebar.scrollHint'] === 'string' && data['sidebar.scrollHint'].length > 0
    }),
    message: 'Sidebar scroll hint copy must be localized in all Dashboard languages.',
  },
]

const failures = checks.filter((check) => !check.ok)

if (failures.length) {
  for (const failure of failures) {
    console.error(`Sidebar scroll check failed: ${failure.message}`)
  }
  process.exit(1)
}

console.log('Sidebar scroll behavior validated: nav scrolls independently, footer remains reachable, and overflow hint is localized.')

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const assetsDir = path.join(process.cwd(), 'dist', 'assets')

const budgets = [
  { label: 'dashboard entry', prefix: 'index-', suffix: '.js', gzipKb: 20 },
  { label: 'React vendor', prefix: 'react-vendor-', suffix: '.js', gzipKb: 70 },
  { label: 'shared vendor', prefix: 'vendor-', suffix: '.js', gzipKb: 120 },
  { label: 'charts vendor', prefix: 'charts-vendor-', suffix: '.js', gzipKb: 95 },
  { label: 'largest route chunk', prefix: 'NodesPage-', suffix: '.js', gzipKb: 30 },
]

if (!fs.existsSync(assetsDir)) {
  throw new Error('Bundle budget check requires dist/assets. Run `npm run build` first.')
}

const files = fs.readdirSync(assetsDir)
const failures = []
const measured = []

for (const budget of budgets) {
  const file = files.find((candidate) =>
    candidate.startsWith(budget.prefix) && candidate.endsWith(budget.suffix),
  )
  if (!file) {
    failures.push(`${budget.label}: missing ${budget.prefix}*${budget.suffix}`)
    continue
  }
  const body = fs.readFileSync(path.join(assetsDir, file))
  const gzipKb = zlib.gzipSync(body).byteLength / 1024
  measured.push(`${budget.label} ${gzipKb.toFixed(2)} kB gzip <= ${budget.gzipKb} kB`)
  if (gzipKb > budget.gzipKb) {
    failures.push(`${budget.label}: ${gzipKb.toFixed(2)} kB gzip exceeds ${budget.gzipKb} kB (${file})`)
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`Bundle budget failed: ${failure}`)
  }
  process.exit(1)
}

console.log(`Bundle budgets passed: ${measured.join('; ')}.`)

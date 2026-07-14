import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ssePath = fileURLToPath(new URL('../src/lib/sse.ts', import.meta.url))
const source = readFileSync(ssePath, 'utf8')

assert(
  source.includes('eventSource = connect(url)'),
  'SSE connections must first use the plain URL so same-origin HttpOnly cookies can authenticate without leaking tokens in query strings.',
)

assert(
  source.includes('!opened && !usingLegacyToken'),
  'Legacy query-token SSE fallback must only run before the cookie-first EventSource has opened.',
)

assert(
  !source.includes('sseUrl = `${url}${separator}token='),
  'SSE helper must not append dashboard tokens to the initial EventSource URL.',
)

console.log('SSE cookie-first connection behavior validated.')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

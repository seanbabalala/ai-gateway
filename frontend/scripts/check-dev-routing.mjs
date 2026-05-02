import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const viteConfigPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const source = readFileSync(viteConfigPath, 'utf8')

if (!source.includes("'/api/'")) {
  throw new Error('Vite dev proxy must use /api/ so the /api-keys SPA route stays routable.')
}

if (source.includes("'/api':")) {
  throw new Error('Vite dev proxy must not use /api because it captures the /api-keys SPA route.')
}

console.log('Open-source Dashboard dev routing validated: /api-keys is not captured by the API proxy.')

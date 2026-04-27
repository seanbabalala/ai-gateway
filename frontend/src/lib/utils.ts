import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Number formatters ──

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

export function formatCost(usd: number): string {
  if (usd >= 1) return '$' + usd.toFixed(2)
  if (usd >= 0.01) return '$' + usd.toFixed(3)
  return '$' + usd.toFixed(4)
}

export function formatLatency(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms) + 'ms'
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function formatPercent(n: number): string {
  return n.toFixed(1) + '%'
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// ── Color constants — Noir Command Center palette ──

export const TIER_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  simple: { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-400', dot: '#2D8659' },
  standard: { bg: 'bg-sky-500/12', text: 'text-sky-700 dark:text-sky-400', dot: '#0284C7' },
  complex: { bg: 'bg-violet-500/12', text: 'text-violet-700 dark:text-violet-400', dot: '#7C3AED' },
  reasoning: { bg: 'bg-rose-500/12', text: 'text-rose-700 dark:text-rose-400', dot: '#E11D48' },
  direct: { bg: 'bg-stone-500/10 dark:bg-stone-500/12', text: 'text-stone-600 dark:text-stone-400', dot: '#78716C' },
}

export const TIER_CHART_COLORS: Record<string, string> = {
  simple: '#2D8659',
  standard: '#0284C7',
  complex: '#7C3AED',
  reasoning: '#E11D48',
  direct: '#78716C',
}

export const NODE_COLORS: Record<string, string> = {
  gpt: '#2D8659',
  claude: '#7C3AED',
  gemini: '#0284C7',
  minimax: '#D4A947',
  deepseek: '#0891B2',
  grok: '#A78BFA',
  mistral: '#F97316',
  groq: '#22D3EE',
  openrouter: '#E879F9',
  ollama: '#6B7280',
}

export function getNodeColor(nodeId: string): string {
  const lower = nodeId.toLowerCase()
  for (const [key, color] of Object.entries(NODE_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#78716C'
}

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

// Signal Console palette

export const TIER_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  simple: { bg: 'bg-emerald-700/10', text: 'text-emerald-800 dark:text-emerald-300', dot: '#064B3A' },
  standard: { bg: 'bg-blue-600/10', text: 'text-blue-800 dark:text-blue-300', dot: '#4867E8' },
  complex: { bg: 'bg-violet-600/10', text: 'text-violet-800 dark:text-violet-300', dot: '#7446C6' },
  reasoning: { bg: 'bg-pink-600/10', text: 'text-pink-800 dark:text-pink-300', dot: '#CC3C7E' },
  direct: { bg: 'bg-slate-500/10 dark:bg-slate-500/12', text: 'text-slate-600 dark:text-slate-300', dot: '#7B8F89' },
}

export const TIER_CHART_COLORS: Record<string, string> = {
  simple: '#064B3A',
  standard: '#4867E8',
  complex: '#7446C6',
  reasoning: '#CC3C7E',
  direct: '#7B8F89',
}

export const NODE_COLORS: Record<string, string> = {
  gpt: '#064B3A',
  claude: '#7446C6',
  gemini: '#4867E8',
  minimax: '#D9872F',
  deepseek: '#189AA8',
  grok: '#A78BFA',
  mistral: '#F97316',
  groq: '#22D3EE',
  openrouter: '#CC3C7E',
  ollama: '#7B8F89',
}

export function getNodeColor(nodeId: string): string {
  const lower = nodeId.toLowerCase()
  for (const [key, color] of Object.entries(NODE_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#7B8F89'
}

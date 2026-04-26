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

// ── Color constants ──

export const TIER_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  simple: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: '#10b981' },
  standard: { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', dot: '#3b82f6' },
  complex: { bg: 'bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', dot: '#a855f7' },
  reasoning: { bg: 'bg-pink-500/15', text: 'text-pink-600 dark:text-pink-400', dot: '#ec4899' },
  direct: { bg: 'bg-zinc-500/10 dark:bg-zinc-500/15', text: 'text-zinc-600 dark:text-zinc-400', dot: '#71717a' },
}

export const TIER_CHART_COLORS: Record<string, string> = {
  simple: '#10b981',
  standard: '#3b82f6',
  complex: '#a855f7',
  reasoning: '#ec4899',
  direct: '#71717a',
}

export const NODE_COLORS: Record<string, string> = {
  gpt: '#10b981',
  claude: '#a855f7',
  gemini: '#3b82f6',
  minimax: '#f59e0b',
}

export function getNodeColor(nodeId: string): string {
  return NODE_COLORS[nodeId] ?? '#71717a'
}

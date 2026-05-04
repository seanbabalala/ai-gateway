import type { TFunction } from 'i18next'
import type { CallLog, NodeDistribution, TierDistribution } from '@/types/api'

const PROMPT_CACHE_TIER = 'cached'
const PROMPT_CACHE_NODE = 'cache'

export function isPromptCacheLog(log: Pick<CallLog, 'tier' | 'node_id'>): boolean {
  return log.tier === PROMPT_CACHE_TIER || log.node_id === PROMPT_CACHE_NODE
}

export function visibleTierDistribution(items: TierDistribution[]): TierDistribution[] {
  return items.filter((item) => item.tier !== PROMPT_CACHE_TIER)
}

export function visibleNodeDistribution(items: NodeDistribution[]): NodeDistribution[] {
  return items.filter((item) => item.nodeId !== PROMPT_CACHE_NODE)
}

export function hiddenPromptCacheCount(
  tierDistribution: TierDistribution[],
  nodeDistribution: NodeDistribution[],
): number {
  const tierCount = tierDistribution.find((item) => item.tier === PROMPT_CACHE_TIER)?.count
  if (typeof tierCount === 'number') return tierCount
  return nodeDistribution.find((item) => item.nodeId === PROMPT_CACHE_NODE)?.count ?? 0
}

export function sourceFormatLabel(sourceFormat: string | null | undefined, t: TFunction): string {
  if (!sourceFormat) return t('common.na', { defaultValue: 'N/A' })
  const fallback = sourceFormat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
  return t(`routeExplanation.sources.${sourceFormat}`, { defaultValue: fallback })
}

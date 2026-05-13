import type { TFunction } from 'i18next'
import type { CallLog, NodeDistribution, TierDistribution } from '@/types/api'

const PROMPT_CACHE_TIER = 'cached'
const PROMPT_CACHE_NODE = 'cache'
const SEMANTIC_CACHE_NODE = 'semantic_cache'

export function isPromptCacheLog(log: Pick<CallLog, 'tier' | 'node_id' | 'semantic_cache_hit'>): boolean {
  return log.node_id === PROMPT_CACHE_NODE || (log.tier === PROMPT_CACHE_TIER && !log.semantic_cache_hit && log.node_id !== SEMANTIC_CACHE_NODE)
}

export function isSemanticCacheLog(log: Pick<CallLog, 'node_id' | 'semantic_cache_hit'>): boolean {
  return log.node_id === SEMANTIC_CACHE_NODE || log.semantic_cache_hit === true
}

export function isProviderCacheLog(
  log: Pick<
    CallLog,
    'node_id' | 'cache_read_input_tokens' | 'semantic_cache_hit' | 'tier'
  >,
): boolean {
  return (
    !isPromptCacheLog(log) &&
    !isSemanticCacheLog(log) &&
    Number(log.cache_read_input_tokens || 0) > 0
  )
}

export function providerCacheSavingsUsd(
  log: Pick<CallLog, 'cost_usd' | 'cost_without_cache_usd'>,
): number {
  return providerCacheCostBreakdown(log).savedCostUsd
}

export function providerCacheCostBreakdown(
  log: Pick<CallLog, 'cost_usd' | 'cost_without_cache_usd'> &
    Partial<
      Pick<
        CallLog,
        'input_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'
      >
    >,
) {
  const actualCostUsd = Number(log.cost_usd || 0)
  const withoutCacheCostUsd = Number(log.cost_without_cache_usd || 0)
  const cacheReadTokens = Number(log.cache_read_input_tokens || 0)
  const cacheCreationTokens = Number(log.cache_creation_input_tokens || 0)
  const cachedInputTokens = cacheReadTokens + cacheCreationTokens
  const inputTokens = Number(log.input_tokens || 0)
  const savedCostUsd = Math.max(0, withoutCacheCostUsd - actualCostUsd)

  return {
    actualCostUsd,
    withoutCacheCostUsd,
    savedCostUsd,
    cacheReadTokens,
    cacheCreationTokens,
    cachedInputTokens,
    cachedInputRatio: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
    hasProviderCacheTokens: cachedInputTokens > 0,
    hasSavingsEstimate: savedCostUsd > 0,
    hasNoCacheEstimate: withoutCacheCostUsd > 0,
  }
}

export function visibleTierDistribution(items: TierDistribution[]): TierDistribution[] {
  return items.filter((item) => item.tier !== PROMPT_CACHE_TIER)
}

export function visibleNodeDistribution(items: NodeDistribution[]): NodeDistribution[] {
  return items.filter((item) => item.nodeId !== PROMPT_CACHE_NODE && item.nodeId !== SEMANTIC_CACHE_NODE)
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

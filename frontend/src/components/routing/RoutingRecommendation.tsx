// ===================================================================
// RoutingRecommendation — Routing suggestion card for RoutingPage
// ===================================================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TierBadge } from '@/components/shared/TierBadge'
import { CapabilityBadge } from '@/components/shared/CapabilityBadge'
import { getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { NodeInfo } from '@/types/api'

interface RoutingRecommendationProps {
  nodes: NodeInfo[]
}

interface TierRec {
  tier: string
  primary: { node: string; model: string } | null
  fallbacks: { node: string; model: string }[]
  score: number
}

// Same affinity data as TierRecommendation — compute locally
const AFFINITY: Record<string, Record<string, number>> = {
  coding: { simple: 0, standard: 0.6, complex: 1.0, reasoning: 0.7 },
  coding_frontend: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.3 },
  coding_backend: { simple: 0, standard: 0.5, complex: 1.0, reasoning: 0.7 },
  reasoning: { simple: 0, standard: 0.2, complex: 0.7, reasoning: 1.0 },
  analysis: { simple: 0, standard: 0.4, complex: 0.8, reasoning: 0.9 },
  creative: { simple: 0.2, standard: 0.7, complex: 0.5, reasoning: 0.2 },
  long_context: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.6 },
  tool_use: { simple: 0, standard: 0.7, complex: 0.8, reasoning: 0.5 },
  fast: { simple: 1.0, standard: 0.3, complex: 0, reasoning: 0 },
  multilingual: { simple: 0.3, standard: 0.6, complex: 0.5, reasoning: 0.3 },
}

function computeRecommendations(nodes: NodeInfo[]): TierRec[] {
  const tiers = ['simple', 'standard', 'complex', 'reasoning']
  const results: TierRec[] = []

  for (const tier of tiers) {
    const scored = nodes.map((node) => {
      const caps = node.capabilities || []
      let tierScore = 0
      if (caps.length > 0) {
        for (const capId of caps) {
          tierScore += AFFINITY[capId]?.[tier] ?? 0
        }
        tierScore /= caps.length
      }
      return { node: node.id, model: node.models[0] || '', score: tierScore }
    })

    scored.sort((a, b) => b.score - a.score)
    const viable = scored.filter((s) => s.score > 0.1)

    if (viable.length > 0) {
      results.push({
        tier,
        primary: { node: viable[0].node, model: viable[0].model },
        fallbacks: viable.slice(1, 3).map((s) => ({ node: s.node, model: s.model })),
        score: Number(viable[0].score.toFixed(2)),
      })
    } else {
      results.push({ tier, primary: null, fallbacks: [], score: 0 })
    }
  }

  return results
}

export function RoutingRecommendation({ nodes }: RoutingRecommendationProps) {
  const { t } = useTranslation('routing')
  const [expanded, setExpanded] = useState(false)

  // Only show if at least one node has capabilities
  const hasCapabilities = nodes.some((n) => n.capabilities && n.capabilities.length > 0)
  if (!hasCapabilities) return null

  const recommendations = computeRecommendations(nodes)

  return (
    <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] shadow-[var(--card-shadow)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="matrix-row flex w-full items-center justify-between rounded-lg px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#052e24] dark:bg-[var(--accent-muted)]">
            <Lightbulb className="h-4 w-4 text-white dark:text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-bold text-[var(--foreground)]">
                {t('recommendation.title')}
              </span>
              <Badge variant="gold" className="text-[9px]">{t('recommendation.badge')}</Badge>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--foreground-dim)]">
              {t('recommendation.description')}
            </div>
          </div>
        </div>
        <span className="rounded-md p-2 text-[var(--foreground-dim)] transition-colors hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="grid gap-4 px-5 pb-5 pt-1 xl:grid-cols-[minmax(260px,0.78fr)_1fr]">
          <div className="rounded-md bg-[var(--background-tertiary)] px-4 py-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('recommendation.nodeCapabilities')}
            </div>
            <div className="space-y-2.5">
              {nodes.filter((n) => n.capabilities && n.capabilities.length > 0).map((node) => (
                <div key={node.id} className="grid grid-cols-[76px_1fr] items-start gap-3">
                  <span
                    className="truncate pt-1 text-[11px] font-semibold"
                    style={{ color: getNodeColor(node.id) }}
                  >
                    {node.id}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {node.capabilities!.map((cap) => (
                      <CapabilityBadge key={cap} capabilityId={cap} size="sm" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 hidden grid-cols-[110px_1fr_1.35fr_64px] gap-3 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)] lg:grid">
              <span>{t('recommendation.tier')}</span>
              <span>{t('recommendation.primary')}</span>
              <span>{t('recommendation.fallbackLane')}</span>
              <span className="text-right">{t('recommendation.score')}</span>
            </div>
            <div className="space-y-2">
              {recommendations.map((rec) => (
                <div
                  key={rec.tier}
                  className="matrix-row grid gap-3 rounded-md px-3 py-3 lg:grid-cols-[110px_1fr_1.35fr_64px] lg:items-center"
                >
                  <div className="flex items-center gap-2">
                    <TierBadge tier={rec.tier} />
                  </div>
                  {rec.primary ? (
                    <>
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: getNodeColor(rec.primary.node) }}
                        />
                        <span className="truncate text-[11px] font-semibold text-[var(--foreground)]">
                          {rec.primary.node}
                        </span>
                        <span className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">
                          {rec.primary.model}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {rec.fallbacks.length > 0 ? rec.fallbacks.map((fb, i) => (
                          <div key={i} className="flex min-w-0 items-center gap-2">
                            {i > 0 && <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />}
                            <div
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: colorWithOpacity(getNodeColor(fb.node), '70') }}
                            />
                            <span className="truncate text-[10px] font-medium text-[var(--foreground-muted)]">
                              {fb.node}
                            </span>
                          </div>
                        )) : (
                          <span className="text-[10px] font-medium text-[var(--foreground-dim)]">
                            {t('recommendation.noFallback')}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[11px] font-bold text-[var(--foreground)] lg:text-right">
                        {rec.score.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] text-[var(--foreground-dim)]">{t('recommendation.noSuitableNode')}</span>
                      <span className="text-[10px] text-[var(--foreground-dim)]">-</span>
                      <span className="font-mono text-[11px] text-[var(--foreground-dim)] lg:text-right">0.00</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

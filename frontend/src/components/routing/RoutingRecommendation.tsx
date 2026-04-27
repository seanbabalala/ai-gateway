// ===================================================================
// RoutingRecommendation — Routing suggestion card for RoutingPage
// ===================================================================

import { useState } from 'react'
import { Lightbulb, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TierBadge } from '@/components/shared/TierBadge'
import { CapabilityBadge } from '@/components/shared/CapabilityBadge'
import { CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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
  const [expanded, setExpanded] = useState(false)

  // Only show if at least one node has capabilities
  const hasCapabilities = nodes.some((n) => n.capabilities && n.capabilities.length > 0)
  if (!hasCapabilities) return null

  const recommendations = computeRecommendations(nodes)

  return (
    <CardStatic className="animate-fade-up border-[var(--accent)]/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-muted)]">
              <Lightbulb className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <CardTitle>Routing Recommendation</CardTitle>
            <Badge variant="gold" className="text-[9px]">Based on capabilities</Badge>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          {/* Node capabilities summary */}
          <div className="mb-5 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
              Node Capabilities
            </div>
            {nodes.filter((n) => n.capabilities && n.capabilities.length > 0).map((node) => (
              <div key={node.id} className="flex items-center gap-2.5">
                <span
                  className="text-[11px] font-semibold w-20 shrink-0"
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

          {/* Recommended routing */}
          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
              Suggested Tier Routing
            </div>
            <div className="grid grid-cols-2 gap-3">
              {recommendations.map((rec) => (
                <div
                  key={rec.tier}
                  className="rounded-xl border border-[var(--border)] bg-[var(--glass-bg)] p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TierBadge tier={rec.tier} />
                    <span className="font-mono text-[10px] text-[var(--foreground-dim)]">
                      ({rec.score.toFixed(2)})
                    </span>
                  </div>
                  {rec.primary ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: getNodeColor(rec.primary.node) }}
                        />
                        <span className="text-[11px] font-semibold text-[var(--foreground)]">
                          {rec.primary.node}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--foreground-dim)]">
                          {rec.primary.model}
                        </span>
                      </div>
                      {rec.fallbacks.map((fb, i) => (
                        <div key={i} className="flex items-center gap-2 ml-2">
                          <ArrowRight className="h-2.5 w-2.5 text-[var(--divider-dim)]" />
                          <div
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: colorWithOpacity(getNodeColor(fb.node), '60') }}
                          />
                          <span className="text-[10px] text-[var(--foreground-muted)]">
                            {fb.node}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-[var(--foreground-dim)]">
                      No suitable node
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </CardStatic>
  )
}

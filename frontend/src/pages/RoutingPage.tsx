import { ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { RoutingRecommendation } from '@/components/routing/RoutingRecommendation'
import { useConfig } from '@/hooks/use-config'
import { useNodes } from '@/hooks/use-nodes'
import { TIER_CHART_COLORS, getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'

export function RoutingPage() {
  const { data: config, isLoading: configLoading } = useConfig()
  const { data: nodesData, isLoading: nodesLoading } = useNodes()

  if (configLoading || nodesLoading || !config) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
      </div>
    )
  }

  const { routing } = config
  const tierNames = Object.keys(routing.tiers)
  const { scoring, domain_preferences } = routing

  // Scoring thresholds for visualization
  const thresholds = [
    { label: 'simple', max: scoring.simple_max, color: TIER_CHART_COLORS.simple },
    { label: 'standard', max: scoring.standard_max, color: TIER_CHART_COLORS.standard },
    { label: 'complex', max: scoring.complex_max, color: TIER_CHART_COLORS.complex },
    { label: 'reasoning', max: 1.0, color: TIER_CHART_COLORS.reasoning },
  ]

  // Normalize threshold values to 0-1 range for visualization
  const minScore = -0.5
  const maxScore = 1.0
  const range = maxScore - minScore

  function scoreToPercent(score: number): number {
    return ((score - minScore) / range) * 100
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routing"
        description="Tier-based routing configuration and scoring thresholds"
      />

      {/* Scoring Threshold Visualization */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>Scoring Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-14 rounded-2xl bg-[var(--inset-bg)] overflow-hidden">
            {/* Tier segments */}
            {thresholds.map((t, i) => {
              const prevMax = i === 0 ? minScore : thresholds[i - 1].max
              const left = scoreToPercent(prevMax)
              const width = scoreToPercent(t.max) - left
              return (
                <div
                  key={t.label}
                  className="absolute top-0 h-full flex items-center justify-center transition-all duration-500"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: colorWithOpacity(t.color, '18'),
                    borderRight:
                      i < thresholds.length - 1
                        ? `2px solid ${colorWithOpacity(t.color, '40')}`
                        : 'none',
                  }}
                >
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: t.color }}
                  >
                    {t.label}
                  </span>
                </div>
              )
            })}
          </div>
          {/* Threshold labels */}
          <div className="relative mt-2 h-5">
            {thresholds.slice(0, -1).map((t) => (
              <span
                key={t.label}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-[var(--foreground-dim)]"
                style={{ left: `${scoreToPercent(t.max)}%` }}
              >
                {t.max}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Routing Recommendation (based on node capabilities) */}
      {nodesData && (
        <RoutingRecommendation nodes={nodesData.nodes} />
      )}

      {/* Tier Routing Cards */}
      <div className="stagger-children grid grid-cols-2 gap-5">
        {tierNames.map((tierName) => {
          const tier = routing.tiers[tierName]
          if (!tier) return null

          return (
            <CardStatic key={tierName} className="animate-fade-up p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <TierBadge tier={tierName} />
                <span className="text-[11px] font-medium text-[var(--foreground-dim)]">tier</span>
              </div>

              {/* Primary Node */}
              <div className="mb-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Primary
                </div>
                <div
                  className="flex items-center gap-2.5 rounded-xl border px-4 py-3"
                  style={{
                    borderColor: colorWithOpacity(getNodeColor(tier.primary.node), '25'),
                    backgroundColor: colorWithOpacity(getNodeColor(tier.primary.node), '06'),
                  }}
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: getNodeColor(tier.primary.node),
                      boxShadow: `0 0 8px ${colorWithOpacity(getNodeColor(tier.primary.node), '40')}`,
                    }}
                  />
                  <span className="font-semibold text-[var(--foreground)]">
                    {tier.primary.node}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--foreground-dim)]">
                    {tier.primary.model}
                  </span>
                </div>
              </div>

              {/* Fallback Chain */}
              {tier.fallbacks && tier.fallbacks.length > 0 && (
                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                    Fallbacks
                  </div>
                  <div className="space-y-1.5">
                    {tier.fallbacks.map((fb, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5"
                      >
                        <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />
                        <div className="flex items-center gap-2 rounded-xl bg-[var(--inset-bg)] px-4 py-2.5 flex-1">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: getNodeColor(fb.node),
                            }}
                          />
                          <span className="text-sm text-[var(--foreground-muted)]">
                            {fb.node}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--foreground-dim)]">
                            {fb.model}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardStatic>
          )
        })}
      </div>

      {/* Domain Preferences */}
      {domain_preferences && Object.keys(domain_preferences).length > 0 && (
        <CardStatic className="animate-fade-up" style={{ animationDelay: '300ms' }}>
          <CardHeader>
            <CardTitle>Domain Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Preferred Nodes (in order)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(domain_preferences).map(([domain, nodes]) => (
                  <TableRow key={domain}>
                    <TableCell>
                      <Badge variant="purple">{domain}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {nodes.map((nodeId, i) => (
                          <span key={nodeId} className="flex items-center gap-1">
                            {i > 0 && (
                              <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />
                            )}
                            <Badge
                              variant="default"
                              className="text-[10px]"
                              style={{
                                backgroundColor: colorWithOpacity(getNodeColor(nodeId), '15'),
                                color: getNodeColor(nodeId),
                              }}
                            >
                              {nodeId}
                            </Badge>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </CardStatic>
      )}
    </div>
  )
}

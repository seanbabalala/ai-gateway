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
import { useConfig } from '@/hooks/use-config'
import { TIER_CHART_COLORS, getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'

export function RoutingPage() {
  const { data: config, isLoading } = useConfig()

  if (isLoading || !config) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--foreground-dim)]">
        Loading routing config...
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
    <div className="space-y-8">
      <PageHeader
        title="Routing"
        description="Tier-based routing configuration and scoring thresholds"
      />

      {/* Scoring Threshold Visualization */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-12 rounded-lg bg-[var(--background-tertiary)] overflow-hidden">
            {/* Tier segments */}
            {thresholds.map((t, i) => {
              const prevMax = i === 0 ? minScore : thresholds[i - 1].max
              const left = scoreToPercent(prevMax)
              const width = scoreToPercent(t.max) - left
              return (
                <div
                  key={t.label}
                  className="absolute top-0 h-full flex items-center justify-center"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: colorWithOpacity(t.color, '25'),
                    borderRight:
                      i < thresholds.length - 1
                        ? `2px solid ${t.color}`
                        : 'none',
                  }}
                >
                  <span
                    className="text-[10px] font-semibold uppercase"
                    style={{ color: t.color }}
                  >
                    {t.label}
                  </span>
                </div>
              )
            })}
          </div>
          {/* Threshold labels */}
          <div className="relative mt-1.5 h-5">
            {thresholds.slice(0, -1).map((t) => (
              <span
                key={t.label}
                className="absolute -translate-x-1/2 text-[10px] font-mono text-[var(--foreground-dim)]"
                style={{ left: `${scoreToPercent(t.max)}%` }}
              >
                {t.max}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tier Routing Cards */}
      <div className="grid grid-cols-2 gap-5">
        {tierNames.map((tierName) => {
          const tier = routing.tiers[tierName]
          if (!tier) return null

          return (
            <CardStatic key={tierName} className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <TierBadge tier={tierName} />
                <span className="text-xs text-[var(--foreground-dim)]">tier</span>
              </div>

              {/* Primary Node */}
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
                  Primary
                </div>
                <div
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                  style={{
                    borderColor: colorWithOpacity(getNodeColor(tier.primary.node), '40'),
                    backgroundColor: colorWithOpacity(getNodeColor(tier.primary.node), '08'),
                  }}
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: getNodeColor(tier.primary.node) }}
                  />
                  <span className="font-medium text-[var(--foreground)]">
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
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
                    Fallbacks
                  </div>
                  <div className="space-y-1.5">
                    {tier.fallbacks.map((fb, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5"
                      >
                        <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />
                        <div className="flex items-center gap-2 rounded-lg bg-[var(--inset-bg)] px-3 py-2 flex-1">
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
        <CardStatic>
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
                                backgroundColor: colorWithOpacity(getNodeColor(nodeId), '20'),
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

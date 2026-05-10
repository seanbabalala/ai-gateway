import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { FlaskConical, Activity, DollarSign, Clock, CheckCircle, Zap } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonChart, Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useExperimentAnalytics } from '@/hooks/use-experiments'
import { useThemeColors } from '@/lib/theme'
import {
  formatCost,
  formatNumber,
  formatLatency,
  formatTokens,
} from '@/lib/utils'

const VARIANT_COLORS = [
  '#064B3A', '#4867E8', '#D9872F', '#7446C6', '#CC3C7E',
  '#189AA8', '#B86B2B', '#8B6AD6',
]

export function ExperimentPage() {
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState('7d')
  const [tierFilter, setTierFilter] = useState<string | undefined>(undefined)
  const { data, isLoading, isError, error, refetch } = useExperimentAnalytics(period, tierFilter)
  const colors = useThemeColors()
  const periodOptions = [
    { value: '7d', label: t('filters.days', { count: 7 }) },
    { value: '30d', label: t('filters.days', { count: 30 }) },
    { value: '90d', label: t('filters.days', { count: 90 }) },
  ]

  // Build tier options from active splits
  const tierOptions = useMemo(() => {
    if (!data?.activeSplits) return []
    return Object.keys(data.activeSplits).map(t => ({ value: t, label: t }))
  }, [data?.activeSplits])

  // Build a color map for experiment groups
  const groupColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (data?.byGroup) {
      data.byGroup.forEach((g, i) => {
        map[g.experimentGroup] = VARIANT_COLORS[i % VARIANT_COLORS.length]
      })
    }
    return map
  }, [data?.byGroup])

  // Transform daily trend for line chart — pivot to { date, group1, group2, ... }
  const chartData = useMemo(() => {
    if (!data?.dailyTrend) return []
    const byDate: Record<string, Record<string, number>> = {}
    for (const d of data.dailyTrend) {
      if (!byDate[d.date]) byDate[d.date] = { date: d.date } as any
      byDate[d.date][`${d.experimentGroup}_latency`] = d.avgLatency
      byDate[d.date][`${d.experimentGroup}_cost`] = d.avgCost
    }
    return Object.values(byDate)
  }, [data?.dailyTrend])

  const groups = data?.byGroup || []
  const uniqueGroups = groups.map(g => g.experimentGroup)

  // Find "winner" — lowest latency, lowest cost, highest success rate
  const winners = useMemo(() => {
    if (groups.length < 2) return null
    const lowestLatency = [...groups].sort((a, b) => a.avgLatency - b.avgLatency)[0]
    const lowestCost = [...groups].sort((a, b) => a.avgCost - b.avgCost)[0]
    const highestSuccess = [...groups].sort((a, b) => b.successRate - a.successRate)[0]
    return { lowestLatency, lowestCost, highestSuccess }
  }, [groups])

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('experiments.title')} description={t('experiments.description')} />
        <SkeletonCard className="h-32" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} className="h-48" />)}
        </div>
        <div className="glass-card-static rounded-2xl p-6">
          <Skeleton className="h-4 w-40 mb-4" />
          <SkeletonChart height={280} />
        </div>
      </div>
    )
  }

  const tooltipStyle = {
    background: colors.chartTooltipBg,
    border: `1px solid ${colors.chartTooltipBorder}`,
    borderRadius: '8px',
    fontSize: '12px',
    padding: '8px 12px',
    boxShadow: '0 22px 52px rgba(5,46,36,0.16)',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('experiments.title')}
        description={t('experiments.description')}
        icon={FlaskConical}
      >
        <div className="flex items-center gap-3">
          {tierOptions.length > 0 && (
            <Select
              className="w-32 h-8 text-[11px]"
              options={[{ value: '', label: t('experiments.allTiers') }, ...tierOptions]}
              value={tierFilter || ''}
              onChange={(v) => setTierFilter(v || undefined)}
            />
          )}
          <div className="flex items-center gap-1 rounded-lg bg-[var(--background-secondary)] p-1 shadow-[0_1px_2px_rgba(5,46,36,0.05)]">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                  period === opt.value
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm'
                    : 'text-[var(--foreground-dim)] hover:text-[var(--foreground)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <ConceptPanel
        conceptId="trafficExperiments"
        icon={FlaskConical}
        badgeKinds={['readOnly', 'configDriven', 'requiresConfig']}
      />

      {/* Empty state */}
      {groups.length === 0 && (
        <Card className="animate-fade-up">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FlaskConical className="h-12 w-12 text-[var(--foreground-dim)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--foreground)]">{t('experiments.emptyTitle')}</h3>
            <p className="mt-2 text-sm text-[var(--foreground-dim)] max-w-md text-center">
              {t('experiments.emptyPrefix')} <code className="px-1.5 py-0.5 rounded bg-[var(--inset-bg)] text-[var(--accent)] text-xs">split</code> {t('experiments.emptySuffix')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Active Splits */}
      {Object.keys(data.activeSplits).length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>{t('experiments.activeTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(data.activeSplits).map(([tier, variants]) => (
                <div key={tier} className="rounded-lg bg-[var(--background-tertiary)] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge variant="purple">{tier}</Badge>
                    <span className="text-[11px] text-[var(--foreground-dim)]">{t('experiments.tier')}</span>
                  </div>
                  <div className="flex items-center gap-2 h-6 rounded-full overflow-hidden">
                    {variants.map((v, i) => (
                      <div
                        key={i}
                        className="h-full flex items-center justify-center text-[9px] font-bold text-white"
                        style={{
                          width: `${v.weight}%`,
                          backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length],
                          borderRadius: i === 0 ? '9999px 0 0 9999px' : i === variants.length - 1 ? '0 9999px 9999px 0' : '0',
                        }}
                      >
                        {v.name || `${v.node}:${v.model}`} ({v.weight}%)
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comparison Cards */}
      {groups.length > 0 && (
        <div className="stagger-children grid grid-cols-2 gap-5 lg:grid-cols-3">
          {groups.map((g, i) => (
            <Card key={g.experimentGroup} className="animate-fade-up">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center gap-2.5">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{
                      backgroundColor: groupColorMap[g.experimentGroup],
                      boxShadow: `0 0 8px ${groupColorMap[g.experimentGroup]}40`,
                    }}
                  />
                  <span className="font-mono text-sm font-semibold text-[var(--foreground)]">
                    {g.experimentGroup}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                      <Zap className="h-3 w-3" /> {t('labels.calls')}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {formatNumber(g.calls)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                      <CheckCircle className="h-3 w-3" /> {t('experiments.success')}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {g.successRate}%
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                      <Clock className="h-3 w-3" /> {t('experiments.avgLatency')}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {formatLatency(g.avgLatency)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                      <DollarSign className="h-3 w-3" /> {t('experiments.avgCost')}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {formatCost(g.avgCost)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--foreground-dim)]">
                  {t('experiments.totalLine', { cost: formatCost(g.totalCost), tokens: formatTokens(g.totalTokens) })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Conclusion Hints */}
      {winners && (
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>{t('experiments.quickComparison')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-[var(--background-tertiary)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-green-500 mb-1">
                  {t('experiments.lowestLatency')}
                </div>
                <div className="font-mono text-sm font-semibold text-[var(--foreground)]">
                  {winners.lowestLatency.experimentGroup}
                </div>
                <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                  {t('experiments.avgValue', { value: formatLatency(winners.lowestLatency.avgLatency) })}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-blue-500 mb-1">
                  {t('experiments.lowestCost')}
                </div>
                <div className="font-mono text-sm font-semibold text-[var(--foreground)]">
                  {winners.lowestCost.experimentGroup}
                </div>
                <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                  {t('experiments.avgCostPerCall', { cost: formatCost(winners.lowestCost.avgCost) })}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-purple-500 mb-1">
                  {t('experiments.highestSuccess')}
                </div>
                <div className="font-mono text-sm font-semibold text-[var(--foreground)]">
                  {winners.highestSuccess.experimentGroup}
                </div>
                <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                  {t('experiments.successRate', { value: winners.highestSuccess.successRate })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Latency Trend Chart */}
      {chartData.length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>{t('experiments.latencyTrend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.chartAxisLine}
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                  axisLine={{ stroke: colors.chartAxisLine }}
                  tickLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  }}
                />
                <YAxis
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v: number) => `${v}ms`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: colors.chartTooltipText }}
                  labelStyle={{ color: colors.chartTooltipText, fontWeight: 600, marginBottom: 4 }}
                />
                <Legend />
                {uniqueGroups.map((group, i) => (
                  <Line
                    key={group}
                    type="monotone"
                    dataKey={`${group}_latency`}
                    name={group}
                    stroke={VARIANT_COLORS[i % VARIANT_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost Trend Chart */}
      {chartData.length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>{t('experiments.costTrend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.chartAxisLine}
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                  axisLine={{ stroke: colors.chartAxisLine }}
                  tickLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  }}
                />
                <YAxis
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v: number) => `$${v.toFixed(4)}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: colors.chartTooltipText }}
                  labelStyle={{ color: colors.chartTooltipText, fontWeight: 600, marginBottom: 4 }}
                  formatter={(value: number) => [formatCost(value), t('experiments.avgCost')]}
                />
                <Legend />
                {uniqueGroups.map((group, i) => (
                  <Line
                    key={group}
                    type="monotone"
                    dataKey={`${group}_cost`}
                    name={group}
                    stroke={VARIANT_COLORS[i % VARIANT_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

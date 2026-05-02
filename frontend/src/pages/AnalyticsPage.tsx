import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { DollarSign, TrendingUp, Coins, Zap, BarChart3 as BarChart3Icon, PieChart as PieChartIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonChart, Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useCostAnalytics } from '@/hooks/use-analytics'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useThemeColors } from '@/lib/theme'
import {
  formatCost,
  formatNumber,
  formatTokens,
  formatLatency,
  getNodeColor,
  TIER_CHART_COLORS,
} from '@/lib/utils'

const MODEL_COLORS = [
  '#064B3A', '#4867E8', '#D9872F', '#7446C6', '#CC3C7E',
  '#189AA8', '#B86B2B', '#8B6AD6', '#287F8C', '#4E756A',
]

export function AnalyticsPage() {
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState('7d')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const { data, isLoading, isError, error, refetch } = useCostAnalytics(
    period,
    apiKeyFilter ? { id: apiKeyFilter } : undefined,
  )
  const { data: apiKeysData } = useApiKeys()
  const colors = useThemeColors()
  const periodOptions = [
    { value: '7d', label: t('filters.days', { count: 7 }) },
    { value: '30d', label: t('filters.days', { count: 30 }) },
    { value: '90d', label: t('filters.days', { count: 90 }) },
  ]

  const apiKeyOptions = [
    { value: '', label: t('filters.allApiKeys') },
    ...(apiKeysData?.items || []).map((key) => ({ value: key.id, label: key.name })),
  ]

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('analytics.title')} description={t('analytics.description')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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
        title={t('analytics.title')}
        description={t('analytics.description')}
        icon={BarChart3Icon}
      >
        <div className="flex items-center gap-3">
          <Select
            options={apiKeyOptions}
            value={apiKeyFilter}
            onChange={(v) => setApiKeyFilter(v)}
            className="w-40"
          />
          <div className="flex items-center gap-1 rounded-lg bg-[var(--background-secondary)] p-1 shadow-[0_1px_2px_rgba(5,46,36,0.05)]">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
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

      {/* Summary Metrics */}
      <div className="stagger-children grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label={t('metrics.totalCost')}
          value={formatCost(data.total.cost)}
          subtitle={t('metrics.period', { count: data.period })}
          icon={DollarSign}
        />
        <MetricCard
          label={t('metrics.totalCalls')}
          value={formatNumber(data.total.calls)}
          subtitle={t('metrics.avgCostPerCall', { cost: formatCost(data.total.avgCostPerCall) })}
          icon={Zap}
        />
        <MetricCard
          label={t('metrics.inputTokens')}
          value={formatTokens(data.total.inputTokens)}
          subtitle={t('metrics.totalTokens', { total: formatTokens(data.total.inputTokens + data.total.outputTokens) })}
          icon={Coins}
        />
        <MetricCard
          label={t('metrics.outputTokens')}
          value={formatTokens(data.total.outputTokens)}
          subtitle={t('metrics.percentOfTotal', {
            value: ((data.total.outputTokens / Math.max(1, data.total.inputTokens + data.total.outputTokens)) * 100).toFixed(0),
          })}
          icon={TrendingUp}
        />
      </div>

      {/* Daily Cost Trend */}
      <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
        <CardHeader>
          <CardTitle>{t('dailyTrend.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.dailyTrend.length === 0 ? (
            <EmptyState icon={TrendingUp} title={t('dailyTrend.emptyTitle')} description={t('dailyTrend.emptyDescription')} className="py-8" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.dailyTrend}>
                <defs>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: colors.chartTooltipText }}
                  labelStyle={{ color: colors.chartTooltipText, fontWeight: 600, marginBottom: 4 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'cost') return [formatCost(value), t('labels.cost')]
                    if (name === 'calls') return [value, t('labels.calls')]
                    return [value, name]
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  fill="url(#costGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Cost by Model + Cost by Node */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Cost Distribution Pie (by Model) */}
        <Card className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <CardTitle>{t('byModel.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byModel.length === 0 ? (
              <EmptyState icon={PieChartIcon} title={t('byModel.emptyTitle')} description={t('byModel.emptyDescription')} className="py-8" />
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.byModel}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="cost"
                      nameKey="model"
                      stroke="var(--background-secondary)"
                      strokeWidth={5}
                      paddingAngle={4}
                      cornerRadius={8}
                    >
                      {data.byModel.map((_entry, i) => (
                        <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: colors.chartTooltipText }}
                      formatter={(value: number) => [formatCost(value), t('labels.cost')]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {data.byModel.slice(0, 6).map((item, i) => (
                    <div key={item.model} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background: MODEL_COLORS[i % MODEL_COLORS.length],
                          boxShadow: `0 0 8px ${MODEL_COLORS[i % MODEL_COLORS.length]}40`,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--foreground-muted)]">
                        {item.model}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] font-semibold text-[var(--foreground)]">
                        {formatCost(item.cost)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost by Node Bar Chart */}
        <Card className="animate-fade-up" style={{ animationDelay: '220ms' }}>
          <CardHeader>
            <CardTitle>{t('byNode.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byNode.length === 0 ? (
              <EmptyState icon={BarChart3Icon} title={t('byNode.emptyTitle')} description={t('byNode.emptyDescription')} className="py-8" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byNode}>
                  <CartesianGrid
                    vertical={false}
                    stroke={colors.chartAxisLine}
                    strokeDasharray="4 8"
                  />
                  <XAxis
                    dataKey="nodeId"
                    tick={{ fill: colors.chartAxisTick, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    axisLine={{ stroke: colors.chartAxisLine }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                    tickFormatter={(v: number) => `$${v.toFixed(1)}`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: colors.chartTooltipText }}
                    formatter={(value: number, name: string) => {
                      if (name === 'cost') return [formatCost(value), t('labels.cost')]
                      return [value, name]
                    }}
                  />
                  <Bar dataKey="cost" radius={[8, 8, 0, 0]} barSize={26}>
                    {data.byNode.map((entry) => (
                      <Cell
                        key={entry.nodeId}
                        fill={getNodeColor(entry.nodeId || '')}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost by Tier */}
      <Card className="animate-fade-up" style={{ animationDelay: '280ms' }}>
        <CardHeader>
          <CardTitle>{t('byTier.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byTier.length === 0 ? (
            <EmptyState icon={Coins} title={t('byTier.emptyTitle')} description={t('byTier.emptyDescription')} className="py-6" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.byTier.map((tierItem) => (
                <div
                  key={tierItem.tier}
                  className="rounded-lg bg-[var(--background-tertiary)] p-4"
                >
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                    {tierItem.tier}
                  </div>
                  <div className="text-xl font-semibold tracking-tight text-[var(--foreground)]"
                    style={{ color: TIER_CHART_COLORS[tierItem.tier || ''] }}
                  >
                    {formatCost(tierItem.cost)}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">
                    {t('byTier.callsTokens', {
                      calls: formatNumber(tierItem.calls),
                      tokens: formatTokens(tierItem.inputTokens + tierItem.outputTokens),
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Breakdown Table */}
      <Card className="animate-fade-up" style={{ animationDelay: '340ms' }}>
        <CardHeader>
          <CardTitle>{t('breakdown.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byModel.length === 0 ? (
            <EmptyState icon={DollarSign} title={t('breakdown.emptyTitle')} description={t('breakdown.emptyDescription')} className="py-6" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('breakdown.model')}</TableHead>
                  <TableHead className="text-right">{t('labels.calls')}</TableHead>
                  <TableHead className="text-right">{t('breakdown.inputTokens')}</TableHead>
                  <TableHead className="text-right">{t('breakdown.outputTokens')}</TableHead>
                  <TableHead className="text-right">{t('breakdown.totalCost')}</TableHead>
                  <TableHead className="text-right">{t('breakdown.avgCostCall')}</TableHead>
                  <TableHead className="text-right">{t('breakdown.avgLatency')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byModel.map((item) => (
                  <TableRow key={item.model}>
                    <TableCell className="font-mono text-[11px] font-medium text-[var(--foreground)]">
                      {item.model}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatNumber(item.calls)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatTokens(item.inputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatTokens(item.outputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] font-semibold text-[var(--foreground)]">
                      {formatCost(item.cost)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatCost(item.avgCostPerCall || 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatLatency(item.avgLatency || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

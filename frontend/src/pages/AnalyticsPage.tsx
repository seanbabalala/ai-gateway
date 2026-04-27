import { useState } from 'react'
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
import { DollarSign, TrendingUp, Coins, Zap } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useCostAnalytics } from '@/hooks/use-analytics'
import { useThemeColors } from '@/lib/theme'
import {
  formatCost,
  formatNumber,
  formatTokens,
  formatLatency,
  getNodeColor,
  TIER_CHART_COLORS,
} from '@/lib/utils'

const periodOptions = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

const MODEL_COLORS = [
  '#D4A947', '#7C3AED', '#0284C7', '#2D8659', '#E11D48',
  '#F97316', '#0891B2', '#A78BFA', '#22D3EE', '#E879F9',
]

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d')
  const { data, isLoading } = useCostAnalytics(period)
  const colors = useThemeColors()

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
      </div>
    )
  }

  const tooltipStyle = {
    background: colors.chartTooltipBg,
    border: `1px solid ${colors.chartTooltipBorder}`,
    borderRadius: '12px',
    fontSize: '12px',
    padding: '8px 12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost Analytics"
        description="Cost trends, breakdown by model and node"
      >
        <div className="flex items-center gap-1 rounded-xl bg-[var(--inset-bg)] p-1">
          {periodOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
                period === opt.value
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--foreground-dim)] hover:text-[var(--foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Summary Metrics */}
      <div className="stagger-children grid grid-cols-4 gap-5">
        <MetricCard
          label="Total Cost"
          value={formatCost(data.total.cost)}
          subtitle={`${data.period}d period`}
          icon={DollarSign}
        />
        <MetricCard
          label="Total Calls"
          value={formatNumber(data.total.calls)}
          subtitle={`Avg ${formatCost(data.total.avgCostPerCall)}/call`}
          icon={Zap}
        />
        <MetricCard
          label="Input Tokens"
          value={formatTokens(data.total.inputTokens)}
          subtitle={`${formatTokens(data.total.inputTokens + data.total.outputTokens)} total`}
          icon={Coins}
        />
        <MetricCard
          label="Output Tokens"
          value={formatTokens(data.total.outputTokens)}
          subtitle={`${((data.total.outputTokens / Math.max(1, data.total.inputTokens + data.total.outputTokens)) * 100).toFixed(0)}% of total`}
          icon={TrendingUp}
        />
      </div>

      {/* Daily Cost Trend */}
      <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
        <CardHeader>
          <CardTitle>Daily Cost Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {data.dailyTrend.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--foreground-dim)]">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.dailyTrend}>
                <defs>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4A947" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#D4A947" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.chartAxisLine}
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'Space Mono' }}
                  axisLine={{ stroke: colors.chartAxisLine }}
                  tickLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  }}
                />
                <YAxis
                  tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'Space Mono' }}
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
                    if (name === 'cost') return [formatCost(value), 'Cost']
                    if (name === 'calls') return [value, 'Calls']
                    return [value, name]
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#D4A947"
                  strokeWidth={2}
                  fill="url(#costGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Cost by Model + Cost by Node */}
      <div className="grid grid-cols-2 gap-5">
        {/* Cost Distribution Pie (by Model) */}
        <Card className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <CardTitle>Cost by Model</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byModel.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--foreground-dim)]">
                No data
              </div>
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
                      stroke="none"
                      paddingAngle={2}
                    >
                      {data.byModel.map((_entry, i) => (
                        <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: colors.chartTooltipText }}
                      formatter={(value: number) => [formatCost(value), 'Cost']}
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
            <CardTitle>Cost by Node</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byNode.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--foreground-dim)]">
                No data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byNode}>
                  <XAxis
                    dataKey="nodeId"
                    tick={{ fill: colors.chartAxisTick, fontSize: 11, fontFamily: 'Space Mono' }}
                    axisLine={{ stroke: colors.chartAxisLine }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'Space Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                    tickFormatter={(v: number) => `$${v.toFixed(1)}`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: colors.chartTooltipText }}
                    formatter={(value: number, name: string) => {
                      if (name === 'cost') return [formatCost(value), 'Cost']
                      return [value, name]
                    }}
                  />
                  <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
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
          <CardTitle>Cost by Tier</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byTier.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--foreground-dim)]">
              No data
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {data.byTier.map((t) => (
                <div
                  key={t.tier}
                  className="rounded-xl bg-[var(--inset-bg)] p-4"
                >
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-dim)]">
                    {t.tier}
                  </div>
                  <div className="text-xl font-semibold tracking-tight text-[var(--foreground)]"
                    style={{ color: TIER_CHART_COLORS[t.tier || ''] }}
                  >
                    {formatCost(t.cost)}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">
                    {formatNumber(t.calls)} calls &middot; {formatTokens(t.inputTokens + t.outputTokens)} tok
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
          <CardTitle>Model Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byModel.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-[var(--foreground-dim)]">
              No data
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="pb-3 pr-4 font-medium text-[var(--foreground-dim)]">Model</th>
                    <th className="pb-3 pr-4 text-right font-medium text-[var(--foreground-dim)]">Calls</th>
                    <th className="pb-3 pr-4 text-right font-medium text-[var(--foreground-dim)]">Input Tokens</th>
                    <th className="pb-3 pr-4 text-right font-medium text-[var(--foreground-dim)]">Output Tokens</th>
                    <th className="pb-3 pr-4 text-right font-medium text-[var(--foreground-dim)]">Total Cost</th>
                    <th className="pb-3 pr-4 text-right font-medium text-[var(--foreground-dim)]">Avg Cost/Call</th>
                    <th className="pb-3 text-right font-medium text-[var(--foreground-dim)]">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((item) => (
                    <tr key={item.model} className="border-b border-[var(--border)]/50">
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-[var(--foreground)]">
                        {item.model}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[var(--foreground-muted)]">
                        {formatNumber(item.calls)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[var(--foreground-muted)]">
                        {formatTokens(item.inputTokens)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[var(--foreground-muted)]">
                        {formatTokens(item.outputTokens)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono font-semibold text-[var(--foreground)]">
                        {formatCost(item.cost)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[var(--foreground-muted)]">
                        {formatCost(item.avgCostPerCall || 0)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-[var(--foreground-muted)]">
                        {formatLatency(item.avgLatency || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

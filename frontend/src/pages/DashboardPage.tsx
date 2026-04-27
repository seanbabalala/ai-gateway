import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Coins, DollarSign, Clock } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { TierBadge } from '@/components/shared/TierBadge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useStats } from '@/hooks/use-stats'
import { useSSELogs } from '@/hooks/use-sse-logs'
import { useThemeColors } from '@/lib/theme'
import {
  formatNumber,
  formatTokens,
  formatCost,
  formatLatency,
  formatTimestamp,
  TIER_CHART_COLORS,
  getNodeColor,
} from '@/lib/utils'

export function DashboardPage() {
  const { data: stats, isLoading } = useStats()
  const { logs: recentLogs } = useSSELogs(5)
  const colors = useThemeColors()

  if (isLoading || !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
      </div>
    )
  }

  const { total, tierDistribution, nodeDistribution } = stats

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Real-time overview of your AI Gateway"
      />

      {/* Metric Cards */}
      <div className="stagger-children grid grid-cols-4 gap-5">
        <MetricCard
          label="Total Calls"
          value={formatNumber(total.calls)}
          subtitle={`${total.successRate.toFixed(1)}% success rate`}
          icon={Activity}
        />
        <MetricCard
          label="Total Tokens"
          value={formatTokens(total.totalTokens)}
          subtitle={`${formatTokens(total.inputTokens)} in / ${formatTokens(total.outputTokens)} out`}
          icon={Coins}
        />
        <MetricCard
          label="Total Cost"
          value={formatCost(total.costUsd)}
          subtitle={`Last 24h: ${formatCost(stats.last24h.costUsd)}`}
          icon={DollarSign}
        />
        <MetricCard
          label="Avg Latency"
          value={formatLatency(total.avgLatencyMs)}
          subtitle={`${formatNumber(total.uniqueSessions)} unique sessions`}
          icon={Clock}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-5">
        {/* Tier Distribution Pie Chart */}
        <Card className="animate-fade-up" style={{ animationDelay: '200ms' }}>
          <CardHeader>
            <CardTitle>Tier Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {tierDistribution.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--foreground-dim)]">
                No data yet
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie
                      data={tierDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      dataKey="count"
                      nameKey="tier"
                      stroke="none"
                      paddingAngle={2}
                    >
                      {tierDistribution.map((entry) => (
                        <Cell
                          key={entry.tier}
                          fill={TIER_CHART_COLORS[entry.tier] ?? '#78716C'}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: colors.chartTooltipBg,
                        border: `1px solid ${colors.chartTooltipBorder}`,
                        borderRadius: '12px',
                        fontSize: '12px',
                        padding: '8px 12px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                      }}
                      itemStyle={{ color: colors.chartTooltipText }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2.5">
                  {tierDistribution.map((entry) => (
                    <div key={entry.tier} className="flex items-center gap-2.5">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          background: TIER_CHART_COLORS[entry.tier] ?? '#78716C',
                          boxShadow: `0 0 8px ${TIER_CHART_COLORS[entry.tier] ?? '#78716C'}40`,
                        }}
                      />
                      <span className="text-xs text-[var(--foreground-muted)] capitalize">
                        {entry.tier}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[var(--foreground)]">
                        {entry.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Node Distribution Bar Chart */}
        <Card className="animate-fade-up" style={{ animationDelay: '260ms' }}>
          <CardHeader>
            <CardTitle>Node Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {nodeDistribution.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--foreground-dim)]">
                No data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={nodeDistribution}>
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
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: colors.chartTooltipBg,
                      border: `1px solid ${colors.chartTooltipBorder}`,
                      borderRadius: '12px',
                      fontSize: '12px',
                      padding: '8px 12px',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                    }}
                    itemStyle={{ color: colors.chartTooltipText }}
                    formatter={(value: number, name: string) => {
                      if (name === 'count') return [value, 'Calls']
                      if (name === 'avgLatencyMs')
                        return [formatLatency(value), 'Avg Latency']
                      return [value, name]
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {nodeDistribution.map((entry) => (
                      <Cell
                        key={entry.nodeId}
                        fill={getNodeColor(entry.nodeId)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls (SSE) */}
      <Card className="animate-fade-up" style={{ animationDelay: '320ms' }}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Recent Calls</CardTitle>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            </span>
            <span className="text-[10px] font-medium text-[var(--accent)]">LIVE</span>
          </div>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-[var(--foreground-dim)]">
              Waiting for incoming requests...
            </div>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence mode="popLayout">
                {recentLogs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3 rounded-xl bg-[var(--inset-bg)] px-4 py-2.5 text-xs"
                  >
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <TierBadge tier={log.tier} />
                    <span className="font-medium text-[var(--foreground-muted)]">{log.node_id}</span>
                    <span className="font-mono text-[var(--foreground-dim)]">{log.model}</span>
                    <span className="ml-auto font-mono text-[var(--foreground-dim)]">
                      {formatTokens(log.input_tokens + log.output_tokens)} tok
                    </span>
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {formatLatency(log.latency_ms)}
                    </span>
                    <span
                      className={
                        log.status_code === 200
                          ? 'font-mono font-semibold text-emerald-600 dark:text-emerald-400'
                          : 'font-mono font-semibold text-red-600 dark:text-red-400'
                      }
                    >
                      {log.status_code}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

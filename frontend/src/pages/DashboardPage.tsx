import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Coins,
  DollarSign,
  Clock,
  Database,
  Trash2,
  BarChart3,
  PieChart as PieChartIcon,
  LayoutDashboard,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Server,
  BellRing,
  ShieldCheck,
  TrendingDown,
  Network,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { TierBadge } from '@/components/shared/TierBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonChart, Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Tooltip } from '@/components/ui/tooltip'
import { useStats } from '@/hooks/use-stats'
import { useSSELogs } from '@/hooks/use-sse-logs'
import { useCacheStats, useClearCache } from '@/hooks/use-cache'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useNamespaces } from '@/hooks/use-namespaces'
import { useConfig } from '@/hooks/use-config'
import { useAlerts } from '@/hooks/use-alerts'
import { useGuardrails } from '@/hooks/use-guardrails'
import { useCacheSavings } from '@/hooks/use-cache-savings'
import { useClusterStatus } from '@/hooks/use-cluster-status'
import { useThemeColors } from '@/lib/theme'
import {
  formatNumber,
  formatTokens,
  formatCost,
  formatLatency,
  formatPercent,
  formatTimestamp,
  TIER_CHART_COLORS,
  getNodeColor,
} from '@/lib/utils'
import {
  hiddenPromptCacheCount,
  isPromptCacheLog,
  visibleNodeDistribution,
  visibleTierDistribution,
} from '@/lib/call-log-display'

type ChartTooltipPayload = {
  color?: string
  dataKey?: string | number
  name?: string | number
  value?: number | string
  payload?: Record<string, unknown>
}

function SignalTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ChartTooltipPayload[]
  label?: string | number
}) {
  const { t } = useTranslation('dashboard')
  if (!active || !payload?.length) return null

  const primary = payload[0]?.payload
  const title =
    (typeof primary?.tier === 'string' && primary.tier) ||
    (typeof primary?.nodeId === 'string' && primary.nodeId) ||
    label

  return (
    <div className="rounded-lg bg-[var(--chart-tooltip-bg)] px-3.5 py-3 shadow-[0_22px_52px_rgba(5,46,36,0.16)]">
      <div className="mb-2 text-[11px] font-bold capitalize text-[var(--chart-tooltip-text)]">
        {title}
      </div>
      <div className="space-y-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '')
          const value = Number(item.value ?? 0)
          const labelText =
            key === 'avgLatencyMs'
              ? t('chart.tooltip.avgLatency')
              : key === 'count'
                ? t('chart.tooltip.calls')
                : String(item.name ?? key)
          const valueText = key === 'avgLatencyMs' ? formatLatency(value) : formatNumber(value)

          return (
            <div key={`${labelText}-${valueText}`} className="flex items-center justify-between gap-5 text-[12px]">
              <span className="flex items-center gap-2 text-[var(--foreground-muted)]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: item.color ?? 'var(--accent)' }}
                />
                {labelText}
              </span>
              <span className="font-mono font-bold text-[var(--foreground)]">{valueText}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [activeTier, setActiveTier] = useState<string | null>(null)
  const [activeNode, setActiveNode] = useState<string | null>(null)
  const { data: stats, isLoading, isError, error, refetch } = useStats({
    id: apiKeyFilter || undefined,
    namespaceId: namespaceFilter || undefined,
  })
  const { logs: recentLogs } = useSSELogs(5)
  const { data: cacheStats } = useCacheStats()
  const clearCache = useClearCache()
  const { data: apiKeysData } = useApiKeys()
  const { data: namespacesData } = useNamespaces()
  const { data: configData } = useConfig()
  const { data: alertsData } = useAlerts()
  const { data: guardrailsData } = useGuardrails()
  const { data: clusterStatus } = useClusterStatus()
  const { data: cacheSavings } = useCacheSavings('1d', 'node', {
    id: apiKeyFilter || undefined,
    namespaceId: namespaceFilter || undefined,
  })
  const colors = useThemeColors()

  const apiKeyOptions = [
    { value: '', label: t('filters.allApiKeys') },
    ...(apiKeysData?.items || []).map((key) => ({ value: key.id, label: key.name })),
  ]
  const namespaceOptions = [
    { value: '', label: t('filters.allNamespaces') },
    ...(namespacesData?.namespaces || []).map((namespace) => ({
      value: namespace.id,
      label: namespace.name || namespace.id,
    })),
  ]

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !stats) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="glass-card-static rounded-2xl p-6">
            <Skeleton className="h-4 w-32 mb-4" />
            <SkeletonChart height={200} />
          </div>
          <div className="glass-card-static rounded-2xl p-6">
            <Skeleton className="h-4 w-32 mb-4" />
            <SkeletonChart height={200} />
          </div>
        </div>
      </div>
    )
  }

  const { total } = stats
  const tierDistribution = visibleTierDistribution(stats.tierDistribution)
  const nodeDistribution = visibleNodeDistribution(stats.nodeDistribution)
  const promptCacheCount = hiddenPromptCacheCount(stats.tierDistribution, stats.nodeDistribution)
  const totalTierCalls = tierDistribution.reduce((sum, entry) => sum + entry.count, 0)
  const maxNodeCalls = Math.max(1, ...nodeDistribution.map((entry) => entry.count))
  const configDiagnostics = configData?.diagnostics || []
  const stateCategories = clusterStatus?.state
    ? Object.values(clusterStatus.state.categories)
    : []
  const sharedCategoryCount = stateCategories.filter((category) => category.shared).length
  const setupWarnings = [
    ...(apiKeysData && apiKeysData.items.length === 0
      ? [t('configHealth.missingApiKey')]
      : []),
    ...configDiagnostics.map((diagnostic) => diagnostic.message),
  ]

  // Calculate trends from last24h data
  const callsTrend = total.calls > 0 ? ((stats.last24h.calls / total.calls) * 100) : 0
  const costTrend = total.costUsd > 0 ? ((stats.last24h.costUsd / total.costUsd) * 100) : 0

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        icon={LayoutDashboard}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            options={namespaceOptions}
            value={namespaceFilter}
            onChange={(v) => setNamespaceFilter(v)}
            className="w-44"
          />
          <Select
            options={apiKeyOptions}
            value={apiKeyFilter}
            onChange={(v) => setApiKeyFilter(v)}
            className="w-40"
          />
        </div>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="animate-fade-up overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-muted)]">
                  {setupWarnings.length > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-[var(--accent)]" />
                  )}
                </div>
                <div>
                  <div className="text-[14px] font-extrabold text-[var(--foreground)]">
                    {t('configHealth.title')}
                  </div>
                  <div className="mt-1 text-[12px] font-medium leading-5 text-[var(--foreground-dim)]">
                    {setupWarnings.length > 0
                      ? t('configHealth.needsAttention', { count: setupWarnings.length })
                      : t('configHealth.ready')}
                  </div>
                  {setupWarnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {setupWarnings.slice(0, 3).map((warning) => (
                        <div key={warning} className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--foreground-dim)] sm:grid-cols-3">
                <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground-muted)]">
                    <Server className="h-3.5 w-3.5" />
                    {t('configHealth.upstreams')}
                  </div>
                  <div className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
                    {configData?.nodes.length ?? '-'}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground-muted)]">
                    <KeyRound className="h-3.5 w-3.5" />
                    {t('configHealth.clientKeys')}
                  </div>
                  <div className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
                    {apiKeysData?.items.length ?? '-'}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                  <div className="font-semibold text-[var(--foreground-muted)]">{t('configHealth.diagnostics')}</div>
                  <div className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
                    {configDiagnostics.length}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up overflow-hidden" style={{ animationDelay: '90ms' }}>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={
                    clusterStatus?.state?.degraded || clusterStatus?.redis.status === 'error'
                      ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]'
                  }
                >
                  <Network className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[14px] font-extrabold text-[var(--foreground)]">
                      {t('cluster.title')}
                    </div>
                    <Badge variant={clusterStatus?.enabled ? 'emerald' : 'zinc'}>
                      {clusterStatus?.enabled ? t('cluster.mode.cluster') : t('cluster.mode.single')}
                    </Badge>
                  </div>
                  <Tooltip content={clusterStatus?.local_node_id || t('cluster.loading')}>
                    <div className="mt-1 max-w-[260px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                      {clusterStatus?.local_node_id || t('cluster.loading')}
                    </div>
                  </Tooltip>
                </div>
              </div>
              <Badge
                variant={
                  clusterStatus?.redis.status === 'ready'
                    ? 'emerald'
                    : clusterStatus?.redis.status === 'error'
                      ? 'red'
                      : 'zinc'
                }
              >
                {t(`cluster.redis.${clusterStatus?.redis.status || 'disabled'}`)}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('cluster.instances')}
                </div>
                <div className="mt-1 font-mono text-[18px] font-extrabold text-[var(--foreground)]">
                  {clusterStatus?.instance_count ?? 1}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('cluster.state')}
                </div>
                <div className="mt-1 font-mono text-[13px] font-extrabold text-[var(--foreground)]">
                  {clusterStatus?.state?.backend || 'memory'}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('cluster.shared')}
                </div>
                <div className="mt-1 font-mono text-[13px] font-extrabold text-[var(--foreground)]">
                  {sharedCategoryCount}/{stateCategories.length || 8}
                </div>
              </div>
            </div>
            {clusterStatus?.state?.degraded || clusterStatus?.redis.last_error ? (
              <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                {clusterStatus.redis.last_error || clusterStatus.state?.last_error || t('cluster.degraded')}
              </div>
            ) : (
              <div className="mt-3 text-[11px] font-medium text-[var(--foreground-dim)]">
                {clusterStatus?.enabled ? t('cluster.ready') : t('cluster.singleReady')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-up" style={{ animationDelay: '140ms' }}>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
              <CardTitle>{t('guardrails.title')}</CardTitle>
            </div>
            <span
              className={
                guardrailsData?.enabled
                  ? 'rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300'
                  : 'rounded-md bg-[var(--background-tertiary)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--foreground-dim)]'
              }
            >
              {guardrailsData?.enabled ? t('guardrails.enabled') : t('guardrails.disabled')}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('guardrails.findings')}
                </div>
                <div className="mt-1 font-mono text-[20px] font-extrabold text-[var(--foreground)]">
                  {guardrailsData?.findings.total ?? 0}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('guardrails.webhook')}
                </div>
                <div className="mt-1 font-mono text-[13px] font-extrabold text-[var(--foreground)]">
                  {guardrailsData?.webhook.enabled
                    ? t(`guardrails.webhookStatus.${guardrailsData.webhook.last_status || 'queued'}`)
                    : guardrailsData?.webhook.configured
                      ? t('guardrails.webhookConfigured')
                      : t('guardrails.webhookOff')}
                </div>
              </div>
            </div>
            {!guardrailsData || guardrailsData.findings.recent.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center rounded-lg bg-[var(--background-tertiary)] text-sm text-[var(--foreground-dim)]">
                {guardrailsData?.enabled ? t('guardrails.empty') : t('guardrails.notConfigured')}
              </div>
            ) : (
              <div className="space-y-2">
                {guardrailsData.findings.recent.slice(0, 4).map((finding, index) => (
                  <div
                    key={`${finding.request_id || 'finding'}-${finding.rule}-${index}`}
                    className="grid gap-2 rounded-lg bg-[var(--background-tertiary)] px-3.5 py-2.5 text-xs sm:grid-cols-[110px_120px_1fr_auto]"
                  >
                    <span className="font-mono font-bold text-[var(--foreground-muted)]">
                      {finding.kind}
                    </span>
                    <span className="truncate font-mono text-[var(--foreground-dim)]">
                      {finding.request_id || t('guardrails.unknownRequest')}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--foreground)]">
                        {finding.rule}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-[var(--foreground-dim)]">
                        {finding.path} · {t('guardrails.matches', { count: finding.match_count ?? 1 })}
                      </div>
                    </div>
                    <span
                      className={
                        finding.action === 'block'
                          ? 'w-fit rounded-md bg-red-500/10 px-2 py-1 font-mono font-bold text-red-700 dark:text-red-300'
                          : finding.action === 'redact'
                            ? 'w-fit rounded-md bg-amber-500/10 px-2 py-1 font-mono font-bold text-amber-700 dark:text-amber-300'
                            : finding.action === 'webhook'
                              ? 'w-fit rounded-md bg-blue-500/10 px-2 py-1 font-mono font-bold text-blue-700 dark:text-blue-300'
                              : 'w-fit rounded-md bg-[var(--background-secondary)] px-2 py-1 font-mono font-bold text-[var(--foreground-dim)]'
                      }
                    >
                      {t(`guardrails.actions.${finding.action}`)}
                    </span>
                  </div>
                ))}
                {guardrailsData.webhook.last_error && (
                  <div className="truncate text-[11px] text-red-700 dark:text-red-300">
                    {t('guardrails.lastWebhookError')}: {guardrailsData.webhook.last_error}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: '120ms' }}>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[var(--accent)]" />
              <CardTitle>{t('alerts.title')}</CardTitle>
            </div>
            <span
              className={
                alertsData?.enabled
                  ? 'rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300'
                  : 'rounded-md bg-[var(--background-tertiary)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--foreground-dim)]'
              }
            >
              {alertsData?.enabled ? t('alerts.enabled') : t('alerts.disabled')}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('alerts.channels')}
                </div>
                <div className="mt-1 font-mono text-[20px] font-extrabold text-[var(--foreground)]">
                  {alertsData?.configured_channels ?? 0}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                  {t('alerts.recent')}
                </div>
                <div className="mt-1 font-mono text-[20px] font-extrabold text-[var(--foreground)]">
                  {alertsData?.recent.length ?? 0}
                </div>
              </div>
            </div>
            {!alertsData || alertsData.recent.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center rounded-lg bg-[var(--background-tertiary)] text-sm text-[var(--foreground-dim)]">
                {alertsData?.enabled ? t('alerts.empty') : t('alerts.notConfigured')}
              </div>
            ) : (
              <div className="space-y-2">
                {alertsData.recent.slice(0, 4).map((alert) => (
                  <div
                    key={alert.id}
                    className="grid gap-2 rounded-lg bg-[var(--background-tertiary)] px-3.5 py-2.5 text-xs sm:grid-cols-[96px_130px_1fr_auto]"
                  >
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {formatTimestamp(alert.timestamp)}
                    </span>
                    <span className="truncate font-mono font-bold text-[var(--foreground-muted)]">
                      {alert.event}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--foreground)]">
                        {alert.message}
                      </div>
                      {alert.last_error && (
                        <div className="mt-1 truncate text-[11px] text-red-700 dark:text-red-300">
                          {alert.last_error}
                        </div>
                      )}
                    </div>
                    <span
                      className={
                        alert.status === 'sent'
                          ? 'w-fit rounded-md bg-emerald-500/10 px-2 py-1 font-mono font-bold text-emerald-700 dark:text-emerald-300'
                          : alert.status === 'failed'
                            ? 'w-fit rounded-md bg-red-500/10 px-2 py-1 font-mono font-bold text-red-700 dark:text-red-300'
                            : 'w-fit rounded-md bg-[var(--background-secondary)] px-2 py-1 font-mono font-bold text-[var(--foreground-dim)]'
                      }
                    >
                      {t(`alerts.status.${alert.status}`)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metric Cards */}
      <div className="stagger-children grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label={t('metrics.totalCalls')}
          value={formatNumber(total.calls)}
          subtitle={t('metrics.successRate', { value: total.successRate.toFixed(1) })}
          icon={Activity}
          trend={stats.last24h.calls > 0 ? { value: callsTrend, label: t('metrics.last24h') } : undefined}
        />
        <MetricCard
          label={t('metrics.totalTokens')}
          value={formatTokens(total.totalTokens)}
          subtitle={t('metrics.tokensInOut', {
            input: formatTokens(total.inputTokens),
            output: formatTokens(total.outputTokens),
          })}
          icon={Coins}
        />
        <MetricCard
          label={t('metrics.totalCost')}
          value={formatCost(total.costUsd)}
          subtitle={t('metrics.last24hCost', { cost: formatCost(stats.last24h.costUsd) })}
          icon={DollarSign}
          trend={stats.last24h.costUsd > 0 ? { value: costTrend, label: t('metrics.last24h') } : undefined}
        />
        <Card className="animate-fade-up relative overflow-hidden p-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_55%)]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                {t('metrics.cacheSavings')}
              </div>
              <div
                className={
                  (cacheSavings?.summary.savings_usd || 0) >= 0
                    ? 'text-[29px] font-extrabold leading-none tracking-tight text-emerald-700 dark:text-emerald-300'
                    : 'text-[29px] font-extrabold leading-none tracking-tight text-amber-700 dark:text-amber-300'
                }
              >
                {formatCost(cacheSavings?.summary.savings_usd || 0)}
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-[var(--foreground-dim)]">
                  {t('metrics.cacheSavingsPercent', {
                    value: formatPercent(cacheSavings?.summary.savings_percentage || 0),
                  })}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                  {t('metrics.cacheSavingsHitRate', {
                    value: formatPercent(cacheSavings?.summary.cache_hit_rate || 0),
                  })}
                </div>
              </div>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <TrendingDown className="h-5 w-5" />
            </div>
          </div>
          <div className="relative mt-5 flex h-6 items-end gap-1">
            {[22, 36, 48, 64, 42, 72, 58, 78, 62].map((height, index) => (
              <div
                key={`cache-savings-${index}`}
                className="w-full rounded-full"
                style={{
                  height: index >= 5 ? `${height}%` : '3px',
                  background:
                    index >= 5 ? 'rgba(34,197,94,0.72)' : 'rgba(34,197,94,0.18)',
                }}
              />
            ))}
          </div>
        </Card>
        <MetricCard
          label={t('metrics.avgLatency')}
          value={formatLatency(total.avgLatencyMs)}
          subtitle={t('metrics.uniqueSessions', { count: formatNumber(total.uniqueSessions) })}
          icon={Clock}
        />
      </div>

      {/* Cache Status */}
      {cacheStats?.enabled && (
        <Card className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--accent)]" />
                <CardTitle>{t('cache.title')}</CardTitle>
              </div>
              <button
                onClick={() => clearCache.mutate()}
                disabled={clearCache.isPending || cacheStats.entries === 0}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--background-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-all hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_12px_28px_rgba(5,46,36,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" />
                {t('cache.clear')}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-lg bg-[var(--background-tertiary)] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-dim)]">
                  {t('cache.hitRate')}
                </p>
                <p className="font-mono text-xl font-bold text-[var(--foreground)]">
                  {cacheStats.hitRate}%
                </p>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-dim)]">
                  {t('cache.hits')}
                </p>
                <p className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatNumber(cacheStats.hits)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-dim)]">
                  {t('cache.misses')}
                </p>
                <p className="font-mono text-xl font-bold text-[var(--foreground-muted)]">
                  {formatNumber(cacheStats.misses)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-dim)]">
                  {t('cache.entries')}
                </p>
                <p className="font-mono text-xl font-bold text-[var(--foreground)]">
                  {cacheStats.entries}
                  <span className="text-xs font-normal text-[var(--foreground-dim)]">
                    {' '}/ {cacheStats.maxEntries}
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-[var(--background-tertiary)] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-dim)]">
                  {t('cache.memory')}
                </p>
                <p className="font-mono text-xl font-bold text-[var(--foreground)]">
                  {cacheStats.memoryMb} MB
                </p>
              </div>
            </div>
            {/* Hit rate progress bar */}
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--progress-track)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(cacheStats.hitRate, 100)}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-5">
        {/* Tier Distribution Pie Chart */}
        <Card className="animate-fade-up xl:col-span-2" style={{ animationDelay: '200ms' }}>
          <CardHeader>
            <div>
              <CardTitle>{t('tierDistribution.title')}</CardTitle>
              <p className="mt-1 text-[12px] font-medium text-[var(--foreground-dim)]">
                {t('tierDistribution.description')}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {tierDistribution.length === 0 ? (
              <EmptyState
                icon={PieChartIcon}
                title={t('tierDistribution.emptyTitle')}
                description={t('tierDistribution.emptyDescription')}
                className="py-8"
              />
            ) : (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="relative mx-auto h-[230px] w-[260px] shrink-0">
                  <PieChart width={260} height={230}>
                    <Pie
                      data={tierDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={66}
                      outerRadius={92}
                      dataKey="count"
                      nameKey="tier"
                      stroke="var(--background-secondary)"
                      strokeWidth={5}
                      paddingAngle={4}
                      cornerRadius={8}
                      onMouseLeave={() => setActiveTier(null)}
                    >
                      {tierDistribution.map((entry) => (
                        <Cell
                          key={entry.tier}
                          fill={TIER_CHART_COLORS[entry.tier] ?? '#7B8F89'}
                          opacity={!activeTier || activeTier === entry.tier ? 1 : 0.34}
                          onMouseEnter={() => setActiveTier(entry.tier)}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<SignalTooltip />} />
                  </PieChart>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="font-mono text-[24px] font-extrabold text-[var(--foreground)]">
                      {formatNumber(totalTierCalls)}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                      {t('tierDistribution.routed')}
                    </div>
                  </div>
                </div>
                <div className="min-w-[150px] space-y-2.5">
                  {tierDistribution.map((entry) => {
                    const color = TIER_CHART_COLORS[entry.tier] ?? '#7B8F89'
                    const pct = totalTierCalls > 0 ? (entry.count / totalTierCalls) * 100 : 0

                    return (
                      <button
                        key={entry.tier}
                        type="button"
                        onMouseEnter={() => setActiveTier(entry.tier)}
                        onMouseLeave={() => setActiveTier(null)}
                        className="w-full rounded-lg bg-[var(--background-tertiary)] px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_30px_rgba(5,46,36,0.08)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2 text-xs font-bold capitalize text-[var(--foreground-muted)]">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                            {entry.tier}
                          </span>
                          <span className="font-mono text-xs font-bold text-[var(--foreground)]">
                            {formatNumber(entry.count)}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: color }}
                          />
                        </div>
                      </button>
                    )
                  })}
                  {promptCacheCount > 0 && (
                    <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      {t('cache.callsHidden', { count: formatNumber(promptCacheCount) })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Node Distribution Bar Chart */}
        <Card className="animate-fade-up xl:col-span-3" style={{ animationDelay: '260ms' }}>
          <CardHeader>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>{t('nodeDistribution.title')}</CardTitle>
                <p className="mt-1 text-[12px] font-medium text-[var(--foreground-dim)]">
                  {t('nodeDistribution.description')}
                </p>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-bold text-[var(--foreground-dim)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--chart-blue)]" />
                  {t('chart.legend.calls')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--chart-orange)]" />
                  {t('chart.legend.latency')}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {nodeDistribution.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title={t('nodeDistribution.emptyTitle')}
                description={t('nodeDistribution.emptyDescription')}
                className="py-8"
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={nodeDistribution} barGap={8} margin={{ top: 12, right: 8, left: 6, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={colors.chartAxisLine} strokeDasharray="4 8" />
                    <XAxis
                      dataKey="nodeId"
                      tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="calls"
                      tick={{ fill: colors.chartAxisTick, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                      axisLine={false}
                      tickLine={false}
                      width={58}
                      tickFormatter={(value: number) => formatNumber(value)}
                    />
                    <YAxis yAxisId="latency" orientation="right" hide />
                    <RechartsTooltip content={<SignalTooltip />} cursor={{ fill: 'rgba(22, 184, 142, 0.06)' }} />
                    <Bar yAxisId="calls" dataKey="count" radius={[8, 8, 0, 0]} barSize={24}>
                      {nodeDistribution.map((entry) => (
                        <Cell
                          key={entry.nodeId}
                          fill={getNodeColor(entry.nodeId)}
                          opacity={!activeNode || activeNode === entry.nodeId ? 1 : 0.42}
                          onMouseEnter={() => setActiveNode(entry.nodeId)}
                          onMouseLeave={() => setActiveNode(null)}
                        />
                      ))}
                    </Bar>
                    <Bar
                      yAxisId="latency"
                      dataKey="avgLatencyMs"
                      radius={[8, 8, 0, 0]}
                      barSize={18}
                      fill="var(--chart-orange)"
                      opacity={0.82}
                    />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {nodeDistribution.slice(0, 4).map((entry) => {
                    const color = getNodeColor(entry.nodeId)
                    return (
                      <div
                        key={entry.nodeId}
                        className="rounded-lg bg-[var(--background-tertiary)] px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_30px_rgba(5,46,36,0.08)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-mono text-[11px] font-bold text-[var(--foreground)]">
                            {entry.nodeId}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--foreground-dim)]">
                            {formatLatency(entry.avgLatencyMs)}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(entry.count / maxNodeCalls) * 100}%`, background: color }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls (SSE) */}
      <Card className="animate-fade-up" style={{ animationDelay: '320ms' }}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>{t('recentCalls.title')}</CardTitle>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
            </div>
            <span className="rounded-md border border-[var(--sse-border)] bg-[var(--sse-bg)] px-2 py-1 text-[10px] font-bold text-[var(--sse-text)]">
              {t('recentCalls.live')}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg bg-[var(--background-tertiary)] text-sm text-[var(--foreground-dim)]">
              {t('recentCalls.waiting')}
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {recentLogs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="grid grid-cols-[92px_auto_1fr_auto_auto_auto] items-center gap-3 rounded-lg bg-[var(--background-tertiary)] px-3.5 py-2.5 text-xs transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_30px_rgba(5,46,36,0.08)]"
                  >
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    {isPromptCacheLog(log) ? (
                      <Badge variant="emerald">{t('cache.hit')}</Badge>
                    ) : (
                      <TierBadge tier={log.tier} />
                    )}
                    <div className="min-w-0">
                      <span className="font-semibold text-[var(--foreground-muted)]">
                        {isPromptCacheLog(log) ? t('cache.noUpstream') : log.node_id}
                      </span>
                      <Tooltip content={log.model}>
                        <span className="ml-2 inline-block max-w-[180px] truncate align-bottom font-mono text-[var(--foreground-dim)]">
                          {log.model}
                        </span>
                      </Tooltip>
                    </div>
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {t('recentCalls.tokens', { count: formatTokens(log.input_tokens + log.output_tokens) })}
                    </span>
                    <span className="font-mono text-[var(--foreground-dim)]">
                      {formatLatency(log.latency_ms)}
                    </span>
                    <span
                      className={
                        log.status_code === 200
                          ? 'rounded-md bg-emerald-500/10 px-2 py-1 font-mono font-bold text-emerald-700 dark:text-emerald-300'
                          : 'rounded-md bg-red-500/10 px-2 py-1 font-mono font-bold text-red-700 dark:text-red-300'
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

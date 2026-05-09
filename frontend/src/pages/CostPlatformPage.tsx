import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  LineChart,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { costPlatformExportUrl, useCostPlatform } from '@/hooks/use-cost-platform'
import { getAuthToken } from '@/contexts/AuthContext'
import { cn, formatCost, formatLatency, formatNumber, formatPercent, formatTokens } from '@/lib/utils'
import type {
  CostPlatformAnomaly,
  CostPlatformChargebackGroup,
  CostPlatformFeedbackRouteSummary,
  CostPlatformGroupBy,
  CostPlatformPriceModelWarning,
  CostPlatformResponse,
} from '@/types/api'

const GROUP_OPTIONS: CostPlatformGroupBy[] = ['team', 'project', 'api_key', 'model', 'node', 'workspace']

function percent(value: number): string {
  return formatPercent(value * 100)
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('dashboard')
  const variant = status === 'ready' ? 'emerald' : status === 'near_budget' ? 'amber' : 'red'
  return <Badge variant={variant}>{t(`costPlatform.closeStatus.${status}`)}</Badge>
}

function ExportButton({
  period,
  groupBy,
  format,
}: {
  period: string
  groupBy: CostPlatformGroupBy
  format: 'csv' | 'json'
}) {
  const { t } = useTranslation('dashboard')
  const handleExport = () => {
    const token = getAuthToken()
    const url = costPlatformExportUrl(period, groupBy, format)
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `siftgate-chargeback-${period}.${format}`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => {})
  }
  return (
    <Button variant="secondary" size="sm" onClick={handleExport}>
      {format === 'csv' ? <Download className="h-3.5 w-3.5" /> : <FileJson className="h-3.5 w-3.5" />}
      {format === 'csv' ? t('costPlatform.actions.exportCsv') : t('costPlatform.actions.exportJson')}
    </Button>
  )
}

function PrivacyContract({ data }: { data: CostPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  const items = [
    t('costPlatform.privacy.noContent'),
    t('costPlatform.privacy.noPayments'),
    t('costPlatform.privacy.noSecrets'),
    t('costPlatform.privacy.feedbackSafe'),
  ]

  return (
    <CardStatic>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <CardTitle>{t('costPlatform.privacy.title')}</CardTitle>
            <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.privacy.description')}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item} className="flex min-h-[48px] items-center gap-2 rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] font-semibold text-[var(--foreground)]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="emerald">{t('costPlatform.privacy.metadataOnly')}</Badge>
          <Badge variant="zinc">{data.version}</Badge>
          <Badge variant="amber">{t('costPlatform.privacy.internalOnly')}</Badge>
        </div>
      </CardContent>
    </CardStatic>
  )
}

function ChargebackTable({ groups }: { groups: CostPlatformChargebackGroup[] }) {
  const { t } = useTranslation('dashboard')
  if (groups.length === 0) {
    return <EmptyState icon={ReceiptText} title={t('costPlatform.empty.chargebackTitle')} description={t('costPlatform.empty.chargebackDescription')} />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('costPlatform.table.group')}</TableHead>
          <TableHead>{t('costPlatform.table.requests')}</TableHead>
          <TableHead>{t('costPlatform.table.cost')}</TableHead>
          <TableHead>{t('costPlatform.table.tokens')}</TableHead>
          <TableHead>{t('costPlatform.table.success')}</TableHead>
          <TableHead>{t('costPlatform.table.latency')}</TableHead>
          <TableHead>{t('costPlatform.table.optimizer')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={`${group.group_by}-${group.group_value}`}>
            <TableCell>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[var(--foreground)]">{group.group_label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-[var(--foreground-muted)]">{group.group_value}</div>
              </div>
            </TableCell>
            <TableCell>{formatNumber(group.requests)}</TableCell>
            <TableCell className="font-semibold">{formatCost(group.cost_usd)}</TableCell>
            <TableCell>{formatTokens(group.total_tokens)}</TableCell>
            <TableCell>{percent(group.success_rate)}</TableCell>
            <TableCell>{formatLatency(group.avg_latency_ms)}</TableCell>
            <TableCell>{formatNumber(group.optimizer_applied)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function AnomalyPanel({ anomalies }: { anomalies: CostPlatformAnomaly[] }) {
  const { t } = useTranslation('dashboard')
  if (anomalies.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t('costPlatform.empty.anomaliesTitle')} description={t('costPlatform.empty.anomaliesDescription')} />
  }

  return (
    <div className="space-y-2">
      {anomalies.slice(0, 8).map((anomaly) => (
        <div key={anomaly.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className={cn('h-4 w-4 shrink-0', anomaly.severity === 'critical' ? 'text-red-500' : 'text-amber-500')} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[var(--foreground)]">{anomaly.key}</div>
                <div className="text-[11px] text-[var(--foreground-dim)]">{t(`costPlatform.groupBy.${anomaly.scope}`)}</div>
              </div>
            </div>
            <Badge variant={anomaly.severity === 'critical' ? 'red' : 'amber'}>{t(`costPlatform.severity.${anomaly.severity}`)}</Badge>
          </div>
          <p className="mt-2 text-[12px] text-[var(--foreground-dim)]">{anomaly.message}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <InlineMetric label={t('costPlatform.anomaly.current')} value={formatCost(anomaly.current_cost_usd)} />
            <InlineMetric label={t('costPlatform.anomaly.baseline')} value={formatCost(anomaly.baseline_cost_usd)} />
            <InlineMetric label={t('costPlatform.anomaly.change')} value={`${Math.round(anomaly.rate_of_change * 100)}%`} tone={anomaly.severity === 'critical' ? 'red' : 'amber'} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PriceSyncPanel({ warnings }: { warnings: CostPlatformPriceModelWarning[] }) {
  const { t } = useTranslation('dashboard')
  if (warnings.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t('costPlatform.empty.priceTitle')} description={t('costPlatform.empty.priceDescription')} />
  }

  return (
    <div className="space-y-2">
      {warnings.slice(0, 8).map((warning) => (
        <div key={`${warning.node_id}-${warning.model}`} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{warning.model}</div>
              <div className="mt-0.5 text-[11px] text-[var(--foreground-dim)]">{warning.node_id}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={warning.freshness === 'stale' ? 'amber' : 'zinc'}>{t(`costPlatform.priceFreshness.${warning.freshness}`)}</Badge>
              {warning.review_required && <Badge variant="red">{t('costPlatform.price.review')}</Badge>}
              {warning.operator_override && <Badge variant="emerald">{t('costPlatform.price.override')}</Badge>}
            </div>
          </div>
          <div className="mt-2 truncate text-[11px] text-[var(--foreground-muted)]">{warning.source}</div>
        </div>
      ))}
    </div>
  )
}

function FeedbackPanel({ rows, title }: { rows: CostPlatformFeedbackRouteSummary[]; title: string }) {
  const { t } = useTranslation('dashboard')
  if (rows.length === 0) {
    return <EmptyState icon={ThumbsUp} title={t('costPlatform.empty.feedbackTitle')} description={t('costPlatform.empty.feedbackDescription')} />
  }

  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((row) => (
        <div key={`${title}-${row.key}`} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{row.key}</div>
              <div className="mt-0.5 text-[11px] text-[var(--foreground-dim)]">{t('costPlatform.feedback.total', { count: row.total })}</div>
            </div>
            <Badge variant={row.positive_rate >= 0.8 ? 'emerald' : row.positive_rate >= 0.5 ? 'amber' : 'red'}>{percent(row.positive_rate)}</Badge>
          </div>
          <div className="mt-3 flex items-center gap-3 text-[12px] text-[var(--foreground-dim)]">
            <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />{row.up}</span>
            <span className="inline-flex items-center gap-1"><ThumbsDown className="h-3.5 w-3.5 text-red-500" />{row.down}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function InlineMetric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'emerald' | 'amber' | 'red' }) {
  return (
    <div className="rounded-lg bg-[var(--background-secondary)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground-dim)]">{label}</div>
      <div className={cn(
        'mt-1 truncate text-[15px] font-bold text-[var(--foreground)]',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        tone === 'red' && 'text-red-600 dark:text-red-400',
      )}>
        {value}
      </div>
    </div>
  )
}

export function CostPlatformPage() {
  const { t } = useTranslation('dashboard')
  const [period, setPeriod] = useState('30d')
  const [groupBy, setGroupBy] = useState<CostPlatformGroupBy>('team')
  const costPlatform = useCostPlatform(period, groupBy)

  const periodOptions = useMemo(() => [
    { value: '7d', label: t('costPlatform.period.7d') },
    { value: '30d', label: t('costPlatform.period.30d') },
    { value: '90d', label: t('costPlatform.period.90d') },
  ], [t])
  const groupOptions = useMemo(() => GROUP_OPTIONS.map((value) => ({
    value,
    label: t(`costPlatform.groupBy.${value}`),
  })), [t])

  if (costPlatform.isError) {
    return <ErrorState error={costPlatform.error} onRetry={costPlatform.refetch} />
  }

  if (costPlatform.isLoading || !costPlatform.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('costPlatform.title')} description={t('costPlatform.description')} icon={ReceiptText} />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonTable rows={5} />
      </div>
    )
  }

  const data = costPlatform.data
  const summary = data.chargeback.summary
  const close = data.chargeback.budget_period_close

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('costPlatform.title')}
        description={t('costPlatform.description')}
        icon={ReceiptText}
        badge={<Badge variant="emerald">{t('costPlatform.badge')}</Badge>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select options={groupOptions} value={groupBy} onChange={(value) => setGroupBy(value as CostPlatformGroupBy)} className="w-40" />
          <Select options={periodOptions} value={period} onChange={setPeriod} className="w-32" />
          <ExportButton period={period} groupBy={groupBy} format="csv" />
          <ExportButton period={period} groupBy={groupBy} format="json" />
        </div>
      </PageHeader>

      <PrivacyContract data={data} />

      <div className="stagger-children grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('costPlatform.metrics.cost')}
          value={formatCost(summary.cost_usd)}
          subtitle={t('costPlatform.metrics.period', { period: data.period.label })}
          icon={ReceiptText}
        />
        <MetricCard
          label={t('costPlatform.metrics.requests')}
          value={formatNumber(summary.requests)}
          subtitle={t('costPlatform.metrics.success', { value: percent(summary.success_rate) })}
          icon={LineChart}
        />
        <MetricCard
          label={t('costPlatform.metrics.savings')}
          value={formatCost(summary.estimated_savings_usd)}
          subtitle={t('costPlatform.metrics.optimizer', { count: summary.optimizer_applied })}
          icon={Sparkles}
        />
        <MetricCard
          label={t('costPlatform.metrics.feedback')}
          value={percent(data.feedback.positive_rate)}
          subtitle={t('costPlatform.metrics.feedbackCount', { count: data.feedback.total })}
          icon={ThumbsUp}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <CardStatic>
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{t('costPlatform.sections.chargeback')}</CardTitle>
              <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.sections.chargebackDescription')}</p>
            </div>
            <StatusBadge status={close.close_status} />
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <InlineMetric label={t('costPlatform.close.cost')} value={formatCost(close.cost_usd)} />
              <InlineMetric label={t('costPlatform.close.limit')} value={close.global_budget_limit_usd == null ? t('costPlatform.values.none') : formatCost(close.global_budget_limit_usd)} />
              <InlineMetric label={t('costPlatform.close.variance')} value={close.variance_usd == null ? t('costPlatform.values.none') : formatCost(close.variance_usd)} tone={close.close_status === 'ready' ? 'emerald' : close.close_status === 'near_budget' ? 'amber' : 'red'} />
            </div>
            <ChargebackTable groups={data.chargeback.groups} />
          </CardContent>
        </CardStatic>

        <CardStatic>
          <CardHeader>
            <CardTitle>{t('costPlatform.sections.anomalies')}</CardTitle>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.sections.anomaliesDescription')}</p>
          </CardHeader>
          <CardContent>
            <AnomalyPanel anomalies={data.anomalies} />
          </CardContent>
        </CardStatic>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('costPlatform.sections.priceSync')}</CardTitle>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.sections.priceSyncDescription')}</p>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge variant={data.price_sync.enabled ? 'emerald' : 'zinc'}>
                {data.price_sync.enabled ? t('costPlatform.price.enabled') : t('costPlatform.price.disabled')}
              </Badge>
              <Badge variant="zinc">{data.price_sync.write_to}</Badge>
              <Badge variant="amber">{t('costPlatform.price.noAutoTrust')}</Badge>
            </div>
            <PriceSyncPanel warnings={data.price_sync.configured_model_warnings} />
          </CardContent>
        </CardStatic>

        <CardStatic>
          <CardHeader>
            <CardTitle>{t('costPlatform.sections.feedbackByModel')}</CardTitle>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.sections.feedbackDescription')}</p>
          </CardHeader>
          <CardContent>
            <FeedbackPanel rows={data.feedback.by_model} title="model" />
          </CardContent>
        </CardStatic>

        <CardStatic>
          <CardHeader>
            <CardTitle>{t('costPlatform.sections.feedbackByNode')}</CardTitle>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('costPlatform.feedback.routeEvidence')}</p>
          </CardHeader>
          <CardContent>
            <FeedbackPanel rows={data.feedback.by_node} title="node" />
          </CardContent>
        </CardStatic>
      </div>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('costPlatform.sections.dailyTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.chargeback.daily_trend.length === 0 ? (
            <EmptyState icon={TrendingUp} title={t('costPlatform.empty.trendTitle')} description={t('costPlatform.empty.trendDescription')} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {data.chargeback.daily_trend.slice(-14).map((day) => (
                <div key={day.date} className="rounded-lg bg-[var(--background-secondary)] p-3">
                  <div className="font-mono text-[10px] text-[var(--foreground-muted)]">{day.date}</div>
                  <div className="mt-1 text-[15px] font-bold text-[var(--foreground)]">{formatCost(day.cost_usd)}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--foreground-dim)]">{t('costPlatform.trend.requests', { count: day.requests })}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

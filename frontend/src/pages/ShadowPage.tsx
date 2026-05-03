import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, DollarSign, GitCompareArrows, Gauge, ShieldCheck, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useNamespaces } from '@/hooks/use-namespaces'
import { useShadowTraffic } from '@/hooks/use-shadow'
import { formatCost, formatLatency, formatPercent, formatTimestamp, formatTokens } from '@/lib/utils'

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return formatPercent(value * 100)
}

function formatDeltaMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatLatency(value)}`
}

function formatDeltaCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatCost(Math.abs(value))}`
}

export function ShadowPage() {
  const { t } = useTranslation('dashboard')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const { data: namespacesData } = useNamespaces()
  const { data, isLoading, isError, error, refetch } = useShadowTraffic(namespaceFilter || undefined)
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

  const status = data?.status
  const report = data?.report
  const recent = data?.recent || []

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('shadow.title')}
        description={t('shadow.description')}
        icon={GitCompareArrows}
      >
        <Select
          options={namespaceOptions}
          value={namespaceFilter}
          onChange={(value) => setNamespaceFilter(value)}
          className="w-44"
        />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.status')}
            </div>
            <div className="mt-2">
              <Badge variant={status?.enabled ? 'emerald' : 'zinc'}>
                {status?.enabled ? t('shadow.enabled') : t('shadow.disabled')}
              </Badge>
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.sampleRate')}
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--foreground)]">
              {Math.round((status?.sample_rate || 0) * 100)}%
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.target')}
            </div>
            <div className="mt-2 truncate font-mono text-[13px] font-semibold text-[var(--foreground)]">
              {status?.target_node || t('shadow.none')}
              {status?.target_model ? ` / ${status.target_model}` : ''}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('shadow.storage')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={status?.privacy.stores_prompts ? 'amber' : 'emerald'}>
                {t('shadow.promptsStorage', {
                  state: status?.privacy.stores_prompts ? t('shadow.on') : t('shadow.off'),
                })}
              </Badge>
              <Badge variant={status?.privacy.stores_responses ? 'amber' : 'emerald'}>
                {t('shadow.responsesStorage', {
                  state: status?.privacy.stores_responses ? t('shadow.on') : t('shadow.off'),
                })}
              </Badge>
            </div>
          </CardContent>
        </CardStatic>
      </div>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('shadow.report.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading || !report ? (
            <SkeletonTable rows={4} cols={4} />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    <Activity className="h-3.5 w-3.5" />
                    {t('shadow.report.samples')}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-[var(--foreground)]">
                    {report.window.rows}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                    {t('shadow.report.comparedLine', {
                      compared: report.window.compared,
                      skipped: report.window.skipped,
                    })}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    <Gauge className="h-3.5 w-3.5" />
                    {t('shadow.report.success')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="emerald">{formatRate(report.success.shadow_success_rate)}</Badge>
                    <span className="text-[11px] text-[var(--foreground-dim)]">
                      {t('shadow.report.primaryRate', {
                        rate: formatRate(report.success.primary_success_rate),
                      })}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    <GitCompareArrows className="h-3.5 w-3.5" />
                    {t('shadow.report.latency')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={report.latency.verdict === 'faster' ? 'emerald' : report.latency.verdict === 'slower' ? 'amber' : 'zinc'}>
                      {t(`shadow.report.latencyVerdict.${report.latency.verdict}`)}
                    </Badge>
                    <span className="font-mono text-[12px] text-[var(--foreground)]">
                      {formatDeltaMs(report.latency.delta_ms)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    <DollarSign className="h-3.5 w-3.5" />
                    {t('shadow.report.cost')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={report.cost.verdict === 'cheaper' ? 'emerald' : report.cost.verdict === 'more_expensive' ? 'amber' : 'zinc'}>
                      {t(`shadow.report.costVerdict.${report.cost.verdict}`)}
                    </Badge>
                    <span className="font-mono text-[12px] text-[var(--foreground)]">
                      {formatDeltaCost(report.cost.delta_usd)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                    {t('shadow.report.savings', {
                      value: formatCost(report.cost.potential_savings_usd),
                    })}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('shadow.report.quality')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={report.quality.status === 'similar' ? 'emerald' : report.quality.status === 'diverged' ? 'red' : report.quality.status === 'watch' ? 'amber' : 'zinc'}>
                      {t(`shadow.report.qualityStatus.${report.quality.status}`)}
                    </Badge>
                    <span className="font-mono text-[12px] text-[var(--foreground)]">
                      {report.quality.average_score === null ? '-' : formatPercent(report.quality.average_score * 100)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                    {t('shadow.report.qualityLine', { count: report.quality.evaluated })}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                      {t('shadow.report.recommendation')}
                    </div>
                    <Badge variant={report.recommendation.decision === 'promote_candidate' ? 'emerald' : report.recommendation.decision === 'investigate' ? 'amber' : 'zinc'}>
                      {t(`shadow.report.decision.${report.recommendation.decision}`)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--foreground-muted)]">
                    {t('shadow.report.confidence', {
                      value: formatPercent(report.recommendation.confidence * 100),
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.recommendation.reasons.slice(0, 3).map((reason) => (
                      <Badge key={reason} variant="blue">
                        {t(`shadow.report.reason.${reason}`, { defaultValue: reason })}
                      </Badge>
                    ))}
                    {report.recommendation.risk_notes.slice(0, 3).map((risk) => (
                      <Badge key={risk} variant="amber">
                        {t(`shadow.report.risk.${risk}`, { defaultValue: risk })}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </CardStatic>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('shadow.recentResults')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={8} cols={8} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={GitCompareArrows}
              title={t('shadow.emptyTitle')}
              description={t('shadow.emptyDescription')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('shadow.table.time')}</TableHead>
                  <TableHead>{t('shadow.table.status')}</TableHead>
                  <TableHead>{t('shadow.table.namespace')}</TableHead>
                  <TableHead>{t('shadow.table.kind')}</TableHead>
                  <TableHead>{t('shadow.table.primary')}</TableHead>
                  <TableHead>{t('shadow.table.shadow')}</TableHead>
                  <TableHead className="text-right">{t('shadow.table.tokens')}</TableHead>
                  <TableHead className="text-right">{t('shadow.table.latency')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {formatTimestamp(item.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === 'sent'
                            ? 'emerald'
                            : item.status === 'failed'
                              ? 'red'
                              : 'zinc'
                        }
                      >
                        {t(`shadow.resultStatus.${item.status}`, { defaultValue: item.status })}
                      </Badge>
                      {item.error && (
                        <div className="mt-1 max-w-[260px] truncate text-[10px] text-red-500">
                          {item.error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.namespace_id || t('shadow.allNamespacesShort')}
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {t(`shadow.kind.${item.kind}`, { defaultValue: item.kind })}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.primary_node} / {item.primary_model}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.shadow_node} / {item.shadow_model}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">
                      {formatTokens(item.input_tokens + item.output_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">
                      {item.latency_ms === null ? '-' : formatLatency(item.latency_ms)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

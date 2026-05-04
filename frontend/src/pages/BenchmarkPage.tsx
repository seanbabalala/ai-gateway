import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Activity,
  BarChart3,
  Gauge,
  MonitorCheck,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { Badge } from '@/components/ui/badge'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useBenchmarkReport } from '@/hooks/use-benchmark-report'
import { useNamespaces } from '@/hooks/use-namespaces'
import { useNodes } from '@/hooks/use-nodes'
import { cn, formatCost, formatLatency, formatNumber, formatPercent, formatTokens } from '@/lib/utils'
import type { BenchmarkCheckStatus, BenchmarkGroup, BenchmarkMetrics } from '@/types/api'

function statusVariant(status: BenchmarkCheckStatus) {
  if (status === 'pass') return 'emerald'
  if (status === 'warn') return 'amber'
  return 'red'
}

function statusLabel(status: BenchmarkCheckStatus, t: TFunction) {
  return t(`benchmark.status.${status}`)
}

function formatSource(source: string, t: TFunction) {
  const normalized = source.replaceAll('-', '_')
  return t(`benchmark.source.${normalized}`, {
    defaultValue: source.replaceAll('_', ' '),
  })
}

function MiniBar({
  value,
  max,
  tone = 'default',
}: {
  value: number
  max: number
  tone?: 'default' | 'latency' | 'success'
}) {
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
      <div
        className={cn(
          'h-full rounded-full',
          tone === 'latency'
            ? 'bg-amber-500'
            : tone === 'success'
              ? 'bg-emerald-500'
              : 'bg-[var(--accent)]',
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

function MetricStrip({ metrics }: { metrics: BenchmarkMetrics }) {
  const { t } = useTranslation('analytics')
  return (
    <div className="grid gap-3 md:grid-cols-5">
      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--foreground-dim)]">
          {t('benchmark.latency.p50')}
        </div>
        <div className="mt-1 font-mono text-[15px] font-bold text-[var(--foreground)]">
          {formatLatency(metrics.latency_ms.p50_ms)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--foreground-dim)]">
          {t('benchmark.latency.p75')}
        </div>
        <div className="mt-1 font-mono text-[15px] font-bold text-[var(--foreground)]">
          {formatLatency(metrics.latency_ms.p75_ms)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--foreground-dim)]">
          {t('benchmark.latency.p95')}
        </div>
        <div className="mt-1 font-mono text-[15px] font-bold text-[var(--foreground)]">
          {formatLatency(metrics.latency_ms.p95_ms)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--foreground-dim)]">
          {t('benchmark.metrics.costCall')}
        </div>
        <div className="mt-1 font-mono text-[15px] font-bold text-[var(--foreground)]">
          {formatCost(metrics.avg_cost_usd)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--foreground-dim)]">
          {t('benchmark.metrics.tokensCall')}
        </div>
        <div className="mt-1 font-mono text-[15px] font-bold text-[var(--foreground)]">
          {formatTokens(metrics.avg_tokens)}
        </div>
      </div>
    </div>
  )
}

function NodeModelTable({ groups }: { groups: BenchmarkGroup[] }) {
  const { t } = useTranslation('analytics')
  const maxCalls = Math.max(...groups.map((item) => item.calls), 0)
  const maxP95 = Math.max(...groups.map((item) => item.latency_ms.p95_ms), 0)

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title={t('benchmark.empty.noGroupsTitle')}
        description={t('benchmark.empty.noGroupsDescription')}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('benchmark.table.target')}</TableHead>
          <TableHead className="text-right">{t('benchmark.table.calls')}</TableHead>
          <TableHead className="text-right">{t('benchmark.table.success')}</TableHead>
          <TableHead>{t('benchmark.table.p95')}</TableHead>
          <TableHead className="text-right">{t('benchmark.table.throughput')}</TableHead>
          <TableHead className="text-right">{t('benchmark.table.cost')}</TableHead>
          <TableHead>{t('benchmark.table.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={`${group.node_id}:${group.model}`}>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {group.node_id}
              </div>
              <div className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                {group.model}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {group.source_formats.slice(0, 3).map((source) => (
                  <Badge key={source} variant="zinc" className="text-[10px]">
                    {formatSource(source, t)}
                  </Badge>
                ))}
                {group.catalog.known_model && (
                  <Badge variant="emerald" className="text-[10px]">
                    {group.catalog.provider || t('benchmark.catalog.known')}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {formatNumber(group.calls)}
              </div>
              <div className="mt-1 min-w-[72px]">
                <MiniBar value={group.calls} max={maxCalls} />
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">
              {formatPercent(group.success_rate)}
            </TableCell>
            <TableCell>
              <div className="mb-1 font-mono text-[12px] text-[var(--foreground)]">
                {formatLatency(group.latency_ms.p95_ms)}
              </div>
              <MiniBar value={group.latency_ms.p95_ms} max={maxP95} tone="latency" />
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">
              {group.throughput_rpm.toFixed(2)}
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">
              {formatCost(group.avg_cost_usd)}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(group.status)}>
                {statusLabel(group.status, t)}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function BenchmarkPage() {
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState<'1h' | '24h' | '7d' | '30d' | '90d'>('24h')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const { data: apiKeysData } = useApiKeys()
  const { data: namespacesData } = useNamespaces()
  const { data: nodesData } = useNodes()
  const { data, isLoading, isError, error, refetch } = useBenchmarkReport({
    period,
    node: nodeFilter || undefined,
    model: modelFilter || undefined,
    source_format: sourceFilter || undefined,
    limit: 5000,
    scope:
      apiKeyFilter || namespaceFilter
        ? { id: apiKeyFilter || undefined, namespaceId: namespaceFilter || undefined }
        : undefined,
  })

  const apiKeyOptions = [
    { value: '', label: t('filters.allApiKeys') },
    ...(apiKeysData?.items || []).map((key) => ({ value: key.id, label: key.name })),
  ]
  const namespaceOptions = [
    { value: '', label: t('benchmark.filters.allNamespaces') },
    ...(namespacesData?.namespaces || []).map((namespace) => ({
      value: namespace.id,
      label: namespace.name || namespace.id,
    })),
  ]
  const nodeOptions = [
    { value: '', label: t('benchmark.filters.allNodes') },
    ...(nodesData?.nodes || []).map((node) => ({ value: node.id, label: node.name || node.id })),
  ]
  const modelOptions = useMemo(() => {
    const models = new Set<string>()
    for (const node of nodesData?.nodes || []) {
      for (const model of node.models || []) models.add(model)
      for (const model of node.embedding_models || []) models.add(model)
      for (const model of node.rerank_models || []) models.add(model)
      for (const model of node.image_models || []) models.add(model)
      for (const model of node.audio_models || []) models.add(model)
      for (const model of node.video_models || []) models.add(model)
      for (const model of node.realtime_models || []) models.add(model)
    }
    return [
      { value: '', label: t('benchmark.filters.allModels') },
      ...Array.from(models).sort().map((model) => ({ value: model, label: model })),
    ]
  }, [nodesData?.nodes, t])
  const sourceOptions = [
    { value: '', label: t('benchmark.filters.allSources') },
    { value: 'chat_completions', label: formatSource('chat_completions', t) },
    { value: 'responses', label: formatSource('responses', t) },
    { value: 'messages', label: formatSource('messages', t) },
    { value: 'embeddings', label: formatSource('embeddings', t) },
    { value: 'rerank', label: formatSource('rerank', t) },
    { value: 'image_generation', label: formatSource('image_generation', t) },
    { value: 'image_edit', label: formatSource('image_edit', t) },
    { value: 'image_variation', label: formatSource('image_variation', t) },
    { value: 'audio_transcription', label: formatSource('audio_transcription', t) },
    { value: 'audio_translation', label: formatSource('audio_translation', t) },
    { value: 'audio_speech', label: formatSource('audio_speech', t) },
    { value: 'video_generation', label: formatSource('video_generation', t) },
    { value: 'realtime', label: formatSource('realtime', t) },
  ]
  const periodOptions = [
    { value: '1h', label: t('benchmark.filters.oneHour') },
    { value: '24h', label: t('benchmark.filters.twentyFourHours') },
    { value: '7d', label: t('filters.days', { count: 7 }) },
    { value: '30d', label: t('filters.days', { count: 30 }) },
    { value: '90d', label: t('filters.days', { count: 90 }) },
  ]

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('benchmark.title')} description={t('benchmark.description')} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)}
        </div>
        <CardStatic>
          <CardContent className="pt-6">
            <SkeletonTable rows={6} cols={6} />
          </CardContent>
        </CardStatic>
      </div>
    )
  }

  const maxSourceCalls = Math.max(...data.by_source_family.map((item) => item.calls), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('benchmark.title')}
        description={t('benchmark.description')}
        icon={Gauge}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select options={apiKeyOptions} value={apiKeyFilter} onChange={setApiKeyFilter} className="w-40" />
          <Select options={namespaceOptions} value={namespaceFilter} onChange={setNamespaceFilter} className="w-40" />
          <Select options={nodeOptions} value={nodeFilter} onChange={setNodeFilter} className="w-40" />
          <Select options={modelOptions} value={modelFilter} onChange={setModelFilter} className="w-44" />
          <Select options={sourceOptions} value={sourceFilter} onChange={setSourceFilter} className="w-44" />
          <Select options={periodOptions} value={period} onChange={(value) => setPeriod(value as typeof period)} className="w-36" />
        </div>
      </PageHeader>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t('benchmark.metrics.sample')}
          value={formatNumber(data.summary.total_requests)}
          subtitle={data.window.truncated ? t('benchmark.metrics.truncated') : t('benchmark.metrics.complete')}
          icon={Activity}
        />
        <MetricCard
          label={t('benchmark.metrics.successRate')}
          value={formatPercent(data.summary.success_rate)}
          subtitle={t('benchmark.metrics.errorRateValue', { value: formatPercent(data.summary.error_rate) })}
          icon={MonitorCheck}
        />
        <MetricCard
          label={t('benchmark.metrics.p95Latency')}
          value={formatLatency(data.summary.latency_ms.p95_ms)}
          subtitle={t('benchmark.metrics.p99Latency', { value: formatLatency(data.summary.latency_ms.p99_ms) })}
          icon={Timer}
        />
        <MetricCard
          label={t('benchmark.metrics.throughput')}
          value={data.summary.throughput.requests_per_minute.toFixed(2)}
          subtitle={t('benchmark.metrics.requestsMinute')}
          icon={Zap}
        />
      </div>

      <CardStatic>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t('benchmark.slo.title')}</CardTitle>
            <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">
              {t('benchmark.slo.description')}
            </p>
          </div>
          <Badge variant="emerald" className="gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            {t('benchmark.privacy.metadataOnly')}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            {data.checks.map((check) => (
              <div key={check.check} className="rounded-lg bg-[var(--background-tertiary)] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-[var(--foreground)]">
                    {t(`benchmark.checks.${check.check}`)}
                  </div>
                  <Badge variant={statusVariant(check.status)}>
                    {statusLabel(check.status, t)}
                  </Badge>
                </div>
                <div className="font-mono text-[20px] font-bold text-[var(--foreground)]">
                  {check.actual}
                </div>
                <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                  {t('benchmark.slo.target', { target: check.target })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg bg-[var(--inset-bg)] p-4">
            <MetricStrip metrics={data.summary} />
          </div>
        </CardContent>
      </CardStatic>

      <div className="grid gap-5 lg:grid-cols-3">
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.metrics.totalCost')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-[28px] font-bold text-[var(--foreground)]">
              {formatCost(data.summary.cost_summary.total_usd)}
            </div>
            <p className="mt-2 text-[12px] text-[var(--foreground-dim)]">
              {t('benchmark.metrics.costCall')}: {formatCost(data.summary.cost_summary.avg_usd_per_request)}
            </p>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.metrics.totalTokens')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-[28px] font-bold text-[var(--foreground)]">
              {formatTokens(data.summary.token_summary.total_tokens)}
            </div>
            <p className="mt-2 text-[12px] text-[var(--foreground-dim)]">
              {t('benchmark.metrics.tokensInOut', {
                input: formatTokens(data.summary.token_summary.input_tokens),
                output: formatTokens(data.summary.token_summary.output_tokens),
              })}
            </p>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.metrics.routeTraceCoverage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-[28px] font-bold text-[var(--foreground)]">
              {formatPercent(data.route_trace_coverage.coverage_rate)}
            </div>
            <p className="mt-2 text-[12px] text-[var(--foreground-dim)]">
              {t('benchmark.metrics.traceMatched', { count: data.route_trace_coverage.matched_requests })}
            </p>
          </CardContent>
        </CardStatic>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.byTarget.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NodeModelTable groups={data.by_node_model} />
          </CardContent>
        </CardStatic>

        <div className="space-y-5">
          <CardStatic>
            <CardHeader>
              <CardTitle>{t('benchmark.byFamily.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.by_source_family.map((item) => (
                  <div key={item.source_family}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-semibold text-[var(--foreground)]">
                        {formatSource(item.source_family, t)}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--foreground-dim)]">
                        {formatNumber(item.calls)}
                      </span>
                    </div>
                    <MiniBar value={item.calls} max={maxSourceCalls} />
                    <div className="mt-1 flex justify-between gap-3 font-mono text-[10px] text-[var(--foreground-dim)]">
                      <span>{formatPercent(item.success_rate)}</span>
                      <span>{formatLatency(item.latency_ms.p95_ms)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </CardStatic>

          <CardStatic>
            <CardHeader>
              <CardTitle>{t('benchmark.status.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.status_breakdown.length === 0 ? (
                  <div className="text-[12px] text-[var(--foreground-dim)]">
                    {t('benchmark.empty.noStatus')}
                  </div>
                ) : (
                  data.status_breakdown.map((item) => (
                    <div key={item.status_code} className="flex items-center justify-between gap-3">
                      <Badge variant={item.status_code < 400 ? 'emerald' : 'red'}>
                        HTTP {item.status_code}
                      </Badge>
                      <div className="flex-1">
                        <MiniBar value={item.rate} max={100} tone={item.status_code < 400 ? 'success' : 'latency'} />
                      </div>
                      <span className="w-16 text-right font-mono text-[11px] text-[var(--foreground-dim)]">
                        {formatPercent(item.rate)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </CardStatic>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.compare.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.comparison_guidance.map((item) => (
                <div key={item.target} className="rounded-lg bg-[var(--background-tertiary)] p-4">
                  <div className="font-semibold text-[var(--foreground)]">{item.target}</div>
                  <div className="mt-1 text-[12px] text-[var(--foreground-muted)]">{item.purpose}</div>
                  <div className="mt-2 font-mono text-[11px] text-[var(--foreground-dim)]">{item.method}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </CardStatic>

        <CardStatic>
          <CardHeader>
            <CardTitle>{t('benchmark.methodology.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-[var(--inset-bg)] p-4 font-mono text-[12px] text-[var(--foreground)]">
              {data.methodology.synthetic_run_script}
            </div>
            <div className="mt-4 space-y-2">
              {data.methodology.notes.map((note) => (
                <div key={note} className="text-[12px] leading-5 text-[var(--foreground-muted)]">
                  {note}
                </div>
              ))}
            </div>
            {data.top_errors.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-[11px] font-bold uppercase text-[var(--foreground-dim)]">
                  {t('benchmark.errors.title')}
                </div>
                <div className="space-y-2">
                  {data.top_errors.map((item) => (
                    <div key={item.error} className="flex items-start justify-between gap-3 rounded-lg bg-red-500/10 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-red-600 dark:text-red-300">
                        {item.error}
                      </span>
                      <span className="font-mono text-[11px] text-red-600 dark:text-red-300">
                        {item.calls}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CardStatic>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  CheckCircle2,
  Clock3,
  FileStack,
  ShieldCheck,
  SquareX,
  TimerReset,
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
import { useBatches } from '@/hooks/use-batches'
import { useNamespaces } from '@/hooks/use-namespaces'
import { useNodes } from '@/hooks/use-nodes'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import type { BatchDashboardItem } from '@/types/api'

type BadgeTone = 'emerald' | 'blue' | 'purple' | 'pink' | 'amber' | 'red' | 'zinc' | 'gold'
type Period = '24h' | '7d' | '30d' | 'all'

function periodOptions(t: TFunction) {
  return [
    { value: '24h', label: t('batches.period.24h') },
    { value: '7d', label: t('batches.period.7d') },
    { value: '30d', label: t('batches.period.30d') },
    { value: 'all', label: t('batches.period.all') },
  ]
}

function statusOptions(t: TFunction) {
  return [
    { value: '', label: t('batches.filters.allStatuses') },
    { value: 'validating', label: t('batches.status.validating') },
    { value: 'queued', label: t('batches.status.queued') },
    { value: 'in_progress', label: t('batches.status.in_progress') },
    { value: 'completed', label: t('batches.status.completed') },
    { value: 'failed', label: t('batches.status.failed') },
    { value: 'cancelled', label: t('batches.status.cancelled') },
    { value: 'expired', label: t('batches.status.expired') },
  ]
}

function statusTone(status: string): BadgeTone {
  if (status === 'completed') return 'emerald'
  if (status === 'failed' || status === 'expired') return 'red'
  if (status === 'cancelled' || status === 'canceled') return 'zinc'
  if (status === 'validating' || status === 'queued') return 'blue'
  return 'amber'
}

function statusLabel(status: string, t: TFunction) {
  return t(`batches.status.${status}`, {
    defaultValue: status.replaceAll('_', ' '),
  })
}

function compactId(value: string | null | undefined) {
  if (!value) return '-'
  if (value.length <= 22) return value
  return `${value.slice(0, 12)}...${value.slice(-6)}`
}

function countsLabel(job: BatchDashboardItem, t: TFunction) {
  const { total, completed, failed } = job.request_counts
  if (total <= 0) return t('batches.values.unknown')
  return t('batches.counts.progress', {
    completed: formatNumber(completed),
    total: formatNumber(total),
    failed: formatNumber(failed),
  })
}

function ProgressBar({ job }: { job: BatchDashboardItem }) {
  const total = job.request_counts.total
  const completed = total > 0 ? Math.min(100, (job.request_counts.completed / total) * 100) : 0
  const failed = total > 0 ? Math.min(100 - completed, (job.request_counts.failed / total) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
      <div className="flex h-full">
        <div className="h-full bg-emerald-500" style={{ width: `${completed}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${failed}%` }} />
      </div>
    </div>
  )
}

function BatchTable({ items, t }: { items: BatchDashboardItem[]; t: TFunction }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileStack}
        title={t('batches.empty.title')}
        description={t('batches.empty.description')}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('batches.table.batch')}</TableHead>
          <TableHead>{t('batches.table.target')}</TableHead>
          <TableHead>{t('batches.table.files')}</TableHead>
          <TableHead>{t('batches.table.requests')}</TableHead>
          <TableHead>{t('batches.table.scope')}</TableHead>
          <TableHead>{t('batches.table.status')}</TableHead>
          <TableHead className="text-right">{t('batches.table.updated')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <div className="font-mono text-[12px] font-bold text-[var(--foreground)]">
                {compactId(job.provider_batch_id || job.request_id)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="zinc" className="text-[10px]">
                  {job.endpoint || t('batches.values.noEndpoint')}
                </Badge>
                {job.completion_window && (
                  <Badge variant="blue" className="text-[10px]">
                    {job.completion_window}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {job.node_id}
              </div>
              <div className="mt-0.5 max-w-[220px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                {job.model}
              </div>
            </TableCell>
            <TableCell>
              <div className="space-y-1 font-mono text-[11px] text-[var(--foreground-dim)]">
                <div>{t('batches.files.input')}: {compactId(job.input_file_id)}</div>
                <div>{t('batches.files.output')}: {compactId(job.output_file_id)}</div>
                {job.error_file_id && <div>{t('batches.files.error')}: {compactId(job.error_file_id)}</div>}
              </div>
              {job.metadata_keys.length > 0 && (
                <div className="mt-2 flex max-w-[240px] flex-wrap gap-1">
                  {job.metadata_keys.slice(0, 4).map((key) => (
                    <Badge key={key} variant="gold" className="text-[10px]">
                      {key}
                    </Badge>
                  ))}
                </div>
              )}
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] text-[var(--foreground)]">
                {countsLabel(job, t)}
              </div>
              <div className="mt-2 min-w-[120px]">
                <ProgressBar job={job} />
              </div>
            </TableCell>
            <TableCell>
              <div className="text-[12px] font-semibold text-[var(--foreground)]">
                {job.namespace_name || job.namespace_id || t('batches.values.noNamespace')}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--foreground-dim)]">
                {job.api_key_name || job.api_key_id || t('batches.values.noApiKey')}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={statusTone(job.status)}>
                {statusLabel(job.status, t)}
              </Badge>
              {job.error && (
                <div className="mt-1 max-w-[180px] truncate text-[11px] text-red-500">
                  {job.error}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right font-mono text-[12px] text-[var(--foreground-dim)]">
              {formatDate(job.updated_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function BatchesPage() {
  const { t } = useTranslation('dashboard')
  const [period, setPeriod] = useState<Period>('24h')
  const [status, setStatus] = useState('')
  const [node, setNode] = useState('')
  const [namespace, setNamespace] = useState('')
  const [apiKeyId, setApiKeyId] = useState('')

  const batches = useBatches({
    period,
    status,
    node,
    namespace,
    api_key_id: apiKeyId,
    limit: 100,
  })
  const nodes = useNodes()
  const namespaces = useNamespaces()
  const apiKeys = useApiKeys()

  const filters = useMemo(() => ({
    nodeOptions: [
      { value: '', label: t('batches.filters.allNodes') },
      ...((nodes.data?.nodes || []).map((item) => ({ value: item.id, label: item.name || item.id }))),
    ],
    namespaceOptions: [
      { value: '', label: t('filters.allNamespaces') },
      ...((namespaces.data?.namespaces || []).map((item) => ({ value: item.id, label: item.name || item.id }))),
    ],
    apiKeyOptions: [
      { value: '', label: t('filters.allApiKeys') },
      ...((apiKeys.data?.items || []).map((item) => ({ value: item.id, label: item.name }))),
    ],
  }), [apiKeys.data?.items, namespaces.data?.namespaces, nodes.data?.nodes, t])

  if (batches.isLoading) {
    return (
      <div>
        <PageHeader title={t('batches.title')} description={t('batches.description')} icon={FileStack} />
        <div className="grid gap-4 md:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="mt-5">
          <SkeletonTable rows={8} />
        </div>
      </div>
    )
  }

  if (batches.isError) {
    return (
      <ErrorState
        error={batches.error as Error}
        onRetry={() => batches.refetch()}
      />
    )
  }

  const data = batches.data

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('batches.title')}
        description={t('batches.description')}
        icon={FileStack}
        badge={
          <Badge variant="gold" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {t('batches.privacy.metadataOnly')}
          </Badge>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label={t('batches.metrics.total')}
          value={formatNumber(data?.totals.total || 0)}
          subtitle={t('batches.metrics.window', { period: t(`batches.period.${period}`) })}
          icon={FileStack}
        />
        <MetricCard
          label={t('batches.metrics.active')}
          value={formatNumber(data?.totals.active || 0)}
          subtitle={t('batches.metrics.inFlight')}
          icon={Clock3}
        />
        <MetricCard
          label={t('batches.metrics.completed')}
          value={formatNumber(data?.totals.completed || 0)}
          subtitle={t('batches.metrics.providerDone')}
          icon={CheckCircle2}
        />
        <MetricCard
          label={t('batches.metrics.failed')}
          value={formatNumber((data?.totals.failed || 0) + (data?.totals.cancelled || 0))}
          subtitle={t('batches.metrics.failedCancelled')}
          icon={SquareX}
        />
      </div>

      <CardStatic>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>{t('batches.filters.title')}</CardTitle>
              <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">
                {t('batches.privacy.description')}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Select value={period} onChange={(value) => setPeriod(value as Period)} options={periodOptions(t)} />
              <Select value={status} onChange={setStatus} options={statusOptions(t)} />
              <Select value={node} onChange={setNode} options={filters.nodeOptions} />
              <Select value={namespace} onChange={setNamespace} options={filters.namespaceOptions} />
              <Select value={apiKeyId} onChange={setApiKeyId} options={filters.apiKeyOptions} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              'mb-4 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] px-3 py-3',
              'text-[12px] text-[var(--foreground-dim)]',
            )}
          >
            <TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span>{t('batches.privacy.noContent')}</span>
          </div>
          <BatchTable items={data?.items || []} t={t} />
        </CardContent>
      </CardStatic>
    </div>
  )
}

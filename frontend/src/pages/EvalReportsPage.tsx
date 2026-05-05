import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Beaker,
  CheckCircle2,
  FlaskConical,
  Scale,
  ShieldCheck,
  Timer,
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
import { useEvalReport, useEvalReports } from '@/hooks/use-evals'
import { cn, formatCost, formatDate, formatLatency, formatNumber, formatPercent } from '@/lib/utils'
import type { EvalRunStatus, EvalRunSummary, EvalSampleSummary, EvalWinner } from '@/types/api'

type BadgeTone = 'emerald' | 'blue' | 'purple' | 'pink' | 'amber' | 'red' | 'zinc' | 'gold'

function statusTone(status: EvalRunStatus): BadgeTone {
  if (status === 'completed') return 'emerald'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'amber'
  return 'blue'
}

function winnerTone(winner: EvalWinner): BadgeTone {
  if (winner === 'candidate') return 'purple'
  if (winner === 'primary') return 'blue'
  if (winner === 'tie') return 'zinc'
  return 'amber'
}

function compactId(value: string | null | undefined) {
  if (!value) return '-'
  if (value.length <= 22) return value
  return `${value.slice(0, 12)}...${value.slice(-6)}`
}

function statusLabel(status: EvalRunStatus, t: TFunction) {
  return t(`evals.status.${status}`, { defaultValue: status })
}

function winnerLabel(winner: EvalWinner, t: TFunction) {
  return t(`evals.winner.${winner || 'unknown'}`)
}

function TargetBlock({ label, target, t }: { label: string; target: EvalRunSummary['primary']; t: TFunction }) {
  return (
    <div className="min-w-[220px] rounded-md border border-[var(--border-subtle)] bg-[var(--background-secondary)] p-3">
      <div className="text-[10px] font-bold uppercase text-[var(--foreground-dim)]">{label}</div>
      <div className="mt-1 font-mono text-[12px] font-semibold text-[var(--foreground)]">
        {target.node_id || t('evals.values.auto')} / {target.model}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-[var(--foreground-dim)]">{t('evals.target.success')}</div>
          <div className="font-mono font-semibold">{formatPercent(target.success_rate)}</div>
        </div>
        <div>
          <div className="text-[var(--foreground-dim)]">{t('evals.target.avgLatency')}</div>
          <div className="font-mono font-semibold">{formatLatency(target.avg_latency_ms)}</div>
        </div>
        <div>
          <div className="text-[var(--foreground-dim)]">{t('evals.target.cost')}</div>
          <div className="font-mono font-semibold">{formatCost(target.total_cost_usd)}</div>
        </div>
        <div>
          <div className="text-[var(--foreground-dim)]">{t('evals.target.fallback')}</div>
          <div className="font-mono font-semibold">{formatPercent(target.fallback_rate)}</div>
        </div>
      </div>
    </div>
  )
}

function RunTable({ runs, t }: { runs: EvalRunSummary[]; t: TFunction }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title={t('evals.empty.title')}
        description={t('evals.empty.description')}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('evals.table.dataset')}</TableHead>
          <TableHead>{t('evals.table.primary')}</TableHead>
          <TableHead>{t('evals.table.candidate')}</TableHead>
          <TableHead className="text-right">{t('evals.table.judge')}</TableHead>
          <TableHead>{t('evals.table.winner')}</TableHead>
          <TableHead className="text-right">{t('evals.table.updated')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Link to={`/evals/${encodeURIComponent(run.id)}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
                {run.dataset_name}
              </Link>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant={statusTone(run.status)}>{statusLabel(run.status, t)}</Badge>
                <Badge variant="zinc">{formatNumber(run.sample_count)} {t('evals.values.samples')}</Badge>
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px]">{run.primary.node_id || t('evals.values.auto')} / {run.primary.model}</div>
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                {formatPercent(run.primary.success_rate)} · {formatLatency(run.primary.avg_latency_ms)} · {formatCost(run.primary.total_cost_usd)}
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px]">{run.candidate.node_id || t('evals.values.auto')} / {run.candidate.model}</div>
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                {formatPercent(run.candidate.success_rate)} · {formatLatency(run.candidate.avg_latency_ms)} · {formatCost(run.candidate.total_cost_usd)}
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">
              {run.judge.avg_score === null ? '-' : run.judge.avg_score.toFixed(3)}
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                {run.judge.model || t('evals.values.auto')}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={winnerTone(run.winner)}>{winnerLabel(run.winner, t)}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-[12px] text-[var(--foreground-dim)]">
              {formatDate(run.updated_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SampleTable({ samples, t }: { samples: EvalSampleSummary[]; t: TFunction }) {
  if (samples.length === 0) {
    return (
      <EmptyState
        icon={Beaker}
        title={t('evals.samples.emptyTitle')}
        description={t('evals.samples.emptyDescription')}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('evals.samples.sample')}</TableHead>
          <TableHead>{t('evals.samples.requests')}</TableHead>
          <TableHead className="text-right">{t('evals.samples.primary')}</TableHead>
          <TableHead className="text-right">{t('evals.samples.candidate')}</TableHead>
          <TableHead className="text-right">{t('evals.samples.judge')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {samples.map((sample) => (
          <TableRow key={sample.id}>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold">{sample.sample_id || compactId(sample.sample_hash)}</div>
              {sample.error_type && <div className="mt-1 max-w-[220px] truncate text-[11px] text-red-500">{sample.error_type}</div>}
            </TableCell>
            <TableCell>
              <div className="space-y-1 font-mono text-[11px] text-[var(--foreground-dim)]">
                <div>{t('evals.samples.primaryShort')}: {compactId(sample.request_ids.primary)}</div>
                <div>{t('evals.samples.candidateShort')}: {compactId(sample.request_ids.candidate)}</div>
                <div>{t('evals.samples.judgeShort')}: {compactId(sample.request_ids.judge)}</div>
              </div>
            </TableCell>
            <TableCell className={cn('text-right font-mono text-[12px]', sample.primary.success ? 'text-emerald-600' : 'text-red-500')}>
              {sample.primary.status_code || '-'} · {formatLatency(sample.primary.latency_ms)}
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">{formatCost(sample.primary.cost_usd)}</div>
            </TableCell>
            <TableCell className={cn('text-right font-mono text-[12px]', sample.candidate.success ? 'text-emerald-600' : 'text-red-500')}>
              {sample.candidate.status_code || '-'} · {formatLatency(sample.candidate.latency_ms)}
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">{formatCost(sample.candidate.cost_usd)}</div>
            </TableCell>
            <TableCell className="text-right">
              <div className="font-mono text-[12px] font-semibold">
                {sample.judge.score === null ? '-' : sample.judge.score.toFixed(3)}
              </div>
              {sample.judge.reason_summary && (
                <div className="ml-auto mt-1 max-w-[260px] truncate text-[11px] text-[var(--foreground-dim)]">
                  {sample.judge.reason_summary}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DetailView({ runId }: { runId: string }) {
  const { t } = useTranslation('dashboard')
  const { data, isLoading, isError, error, refetch } = useEvalReport(runId)

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t('evals.detail.title')} description={t('evals.detail.description')} icon={Scale} />
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

  if (isError || !data) {
    return (
      <ErrorState
        error={error instanceof Error ? error : new Error(t('error.generic', { ns: 'common' }))}
        onRetry={() => refetch()}
      />
    )
  }

  const run = data.run
  return (
    <div>
      <PageHeader
        title={run.dataset_name}
        description={t('evals.detail.description')}
        icon={Scale}
        badge={<Badge variant={statusTone(run.status)}>{statusLabel(run.status, t)}</Badge>}
      />

      <div className="mb-5">
        <Link to="/evals" className="text-[12px] font-semibold text-[var(--accent)] hover:underline">
          {t('evals.detail.back')}
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label={t('evals.metrics.samples')} value={formatNumber(run.sample_count)} icon={Beaker} />
        <MetricCard label={t('evals.metrics.judgeScore')} value={run.judge.avg_score === null ? '-' : run.judge.avg_score.toFixed(3)} icon={Scale} />
        <MetricCard label={t('evals.metrics.latencyDelta')} value={formatLatency(Number(run.summary.latency_delta_ms || 0))} icon={Timer} />
        <MetricCard label={t('evals.metrics.costDelta')} value={formatCost(Number(run.summary.cost_delta_usd || 0))} icon={CheckCircle2} />
      </div>

      <CardStatic className="mt-5">
        <CardHeader>
          <CardTitle>{t('evals.sections.comparison')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <TargetBlock label={t('evals.table.primary')} target={run.primary} t={t} />
            <div className="flex items-center justify-center">
              <Badge variant={winnerTone(run.winner)}>{winnerLabel(run.winner, t)}</Badge>
            </div>
            <TargetBlock label={t('evals.table.candidate')} target={run.candidate} t={t} />
          </div>
        </CardContent>
      </CardStatic>

      <CardStatic className="mt-5">
        <CardHeader>
          <CardTitle>{t('evals.sections.samples')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SampleTable samples={data.samples} t={t} />
        </CardContent>
      </CardStatic>

      <CardStatic className="mt-5 border-emerald-500/20 bg-emerald-500/[0.04]">
        <CardContent className="flex gap-3 py-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <div className="text-[12px] font-bold text-[var(--foreground)]">{t('evals.privacy.title')}</div>
            <div className="mt-1 text-[12px] text-[var(--foreground-dim)]">
              {data.privacy.sample_previews_stored ? t('evals.privacy.samplesStored') : t('evals.privacy.metadataOnly')}
            </div>
          </div>
        </CardContent>
      </CardStatic>
    </div>
  )
}

export function EvalReportsPage() {
  const { t } = useTranslation('dashboard')
  const { runId } = useParams()
  const [period, setPeriod] = useState<'24h' | '7d' | '30d' | '90d' | 'all'>('30d')
  const [status, setStatus] = useState('')
  const { data, isLoading, isError, error, refetch } = useEvalReports({
    period,
    status,
    limit: 100,
  })

  const statusOptions = useMemo(() => [
    { value: '', label: t('evals.filters.allStatuses') },
    { value: 'queued', label: t('evals.status.queued') },
    { value: 'running', label: t('evals.status.running') },
    { value: 'completed', label: t('evals.status.completed') },
    { value: 'failed', label: t('evals.status.failed') },
  ], [t])

  if (runId) return <DetailView runId={runId} />

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t('evals.title')} description={t('evals.description')} icon={FlaskConical} />
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

  if (isError || !data) {
    return (
      <ErrorState
        error={error instanceof Error ? error : new Error(t('error.generic', { ns: 'common' }))}
        onRetry={() => refetch()}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={t('evals.title')}
        description={t('evals.description')}
        icon={FlaskConical}
        badge={<Badge variant="gold">{t('evals.badge.readOnly')}</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label={t('evals.metrics.runs')} value={formatNumber(data.totals.runs)} icon={FlaskConical} />
        <MetricCard label={t('evals.metrics.samples')} value={formatNumber(data.totals.samples)} icon={Beaker} />
        <MetricCard label={t('evals.metrics.completed')} value={formatNumber(data.totals.completed)} icon={CheckCircle2} />
        <MetricCard label={t('evals.metrics.judgeScore')} value={data.totals.avg_judge_score === null ? '-' : data.totals.avg_judge_score.toFixed(3)} icon={Scale} />
      </div>

      <CardStatic className="mt-5">
        <CardContent className="grid gap-3 py-4 md:grid-cols-[180px_180px_1fr]">
          <Select
            value={period}
            onChange={(value) => setPeriod(value as typeof period)}
            options={[
              { value: '24h', label: t('evals.period.24h') },
              { value: '7d', label: t('evals.period.7d') },
              { value: '30d', label: t('evals.period.30d') },
              { value: '90d', label: t('evals.period.90d') },
              { value: 'all', label: t('evals.period.all') },
            ]}
          />
          <Select value={status} onChange={setStatus} options={statusOptions} />
          <div className="flex items-center gap-2 rounded-md bg-[var(--background-secondary)] px-3 text-[12px] text-[var(--foreground-dim)]">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {data.privacy.metadata_only ? t('evals.privacy.metadataOnly') : t('evals.privacy.samplesStored')}
          </div>
        </CardContent>
      </CardStatic>

      <CardStatic className="mt-5">
        <CardHeader>
          <CardTitle>{t('evals.sections.reports')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RunTable runs={data.items} t={t} />
        </CardContent>
      </CardStatic>
    </div>
  )
}

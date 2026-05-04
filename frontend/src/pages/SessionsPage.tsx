import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  GitBranch,
  Layers3,
  Network,
  Route,
  Search,
  ShieldCheck,
  Timer,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { TierBadge } from '@/components/shared/TierBadge'
import { Badge } from '@/components/ui/badge'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
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
import { useNamespaces } from '@/hooks/use-namespaces'
import { useSessionDetail, useSessions } from '@/hooks/use-sessions'
import { cn, formatCost, formatDate, formatLatency, formatNumber, formatTokens } from '@/lib/utils'
import type { SessionSummary, SessionTimelineEvent } from '@/types/api'

const LIMIT = 25
type BadgeTone = 'emerald' | 'blue' | 'purple' | 'pink' | 'amber' | 'red' | 'zinc' | 'gold'

function periodOptions(t: TFunction) {
  return [
    { value: '1h', label: t('sessions.filters.period.1h') },
    { value: '24h', label: t('sessions.filters.period.24h') },
    { value: '7d', label: t('sessions.filters.period.7d') },
    { value: '30d', label: t('sessions.filters.period.30d') },
    { value: 'all', label: t('sessions.filters.period.all') },
  ]
}

function sourceOptions(t: TFunction) {
  return [
    { value: '', label: t('sessions.filters.allSources') },
    { value: 'chat_completions', label: t('sessions.sources.chat_completions') },
    { value: 'responses', label: t('sessions.sources.responses') },
    { value: 'messages', label: t('sessions.sources.messages') },
    { value: 'embeddings', label: t('sessions.sources.embeddings') },
    { value: 'rerank', label: t('sessions.sources.rerank') },
    { value: 'image_generation', label: t('sessions.sources.image_generation') },
    { value: 'image_edit', label: t('sessions.sources.image_edit') },
    { value: 'image_variation', label: t('sessions.sources.image_variation') },
    { value: 'audio_transcription', label: t('sessions.sources.audio_transcription') },
    { value: 'audio_translation', label: t('sessions.sources.audio_translation') },
    { value: 'audio_speech', label: t('sessions.sources.audio_speech') },
    { value: 'video_generation', label: t('sessions.sources.video_generation') },
  ]
}

function sourceLabel(source: string, t: TFunction) {
  const normalized = source.replaceAll('-', '_')
  return t(`sessions.sources.${normalized}`, {
    defaultValue: source.replaceAll('_', ' '),
  })
}

function statusVariant(status: number | null): BadgeTone {
  if (status === null) return 'zinc'
  if (status >= 500) return 'red'
  if (status >= 400) return 'amber'
  return 'emerald'
}

function timelineTone(event: SessionTimelineEvent) {
  if (event.status_code >= 500 || event.error) return 'bg-red-500'
  if (event.status_code >= 400 || event.is_fallback) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function compactId(value: string | null | undefined) {
  if (!value) return '-'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-6)}`
}

function SummaryPill({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-[var(--inset-bg)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[13px] font-bold text-[var(--foreground)]">
        {value}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  selected,
  t,
}: {
  session: SessionSummary
  selected: boolean
  t: TFunction
}) {
  const health: BadgeTone =
    session.error_count > 0
      ? 'red'
      : session.fallback_count > 0
        ? 'amber'
        : 'emerald'

  return (
    <Link
      to={`/sessions/${encodeURIComponent(session.session_id)}`}
      className={cn(
        'block rounded-lg border px-3 py-3 transition-all',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-muted)] shadow-[0_10px_30px_rgba(5,46,36,0.10)]'
          : 'border-[var(--border)] bg-[var(--background-secondary)] hover:-translate-y-0.5 hover:border-[var(--accent)]/35 hover:shadow-[0_14px_32px_rgba(5,46,36,0.08)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] font-bold text-[var(--foreground)]">
            {compactId(session.session_id)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {session.source_formats.slice(0, 2).map((source) => (
              <Badge key={source} variant="zinc" className="text-[10px]">
                {sourceLabel(source, t)}
              </Badge>
            ))}
            {session.model_switch_count > 0 && (
              <Badge variant="blue" className="text-[10px]">
                {t('sessions.badges.switches', { count: session.model_switch_count })}
              </Badge>
            )}
          </div>
        </div>
        <Badge variant={health} className="shrink-0">
          {session.error_count > 0
            ? t('sessions.status.error')
            : session.fallback_count > 0
              ? t('sessions.status.fallback')
              : t('sessions.status.clean')}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <SummaryPill label={t('sessions.list.requests')} value={formatNumber(session.request_count)} />
        <SummaryPill label={t('sessions.list.cost')} value={formatCost(session.total_cost_usd)} />
        <SummaryPill label={t('sessions.list.latency')} value={formatLatency(session.avg_latency_ms)} />
      </div>
      <div className="mt-2 truncate text-[11px] text-[var(--foreground-dim)]">
        {session.models.slice(0, 2).join(', ') || t('sessions.values.none')}
      </div>
    </Link>
  )
}

function TimelineTable({
  events,
  t,
}: {
  events: SessionTimelineEvent[]
  t: TFunction
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title={t('sessions.empty.timelineTitle')}
        description={t('sessions.empty.timelineDescription')}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('sessions.timeline.time')}</TableHead>
          <TableHead>{t('sessions.timeline.request')}</TableHead>
          <TableHead>{t('sessions.timeline.route')}</TableHead>
          <TableHead className="text-right">{t('sessions.timeline.latency')}</TableHead>
          <TableHead className="text-right">{t('sessions.timeline.cost')}</TableHead>
          <TableHead>{t('sessions.timeline.links')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.request_id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', timelineTone(event))} />
                <span className="font-mono text-[12px] text-[var(--foreground)]">
                  {formatDate(event.timestamp)}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {compactId(event.request_id)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant={statusVariant(event.status_code)}>
                  {event.status_code}
                </Badge>
                <TierBadge tier={event.tier} />
                <Badge variant="zinc">
                  {sourceLabel(event.source_format, t)}
                </Badge>
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {event.node_id}
              </div>
              <div className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                {event.model}
              </div>
              {event.fallback_reason && (
                <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {t('sessions.timeline.fallback')}: {event.fallback_reason}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">
              {formatLatency(event.latency_ms)}
            </TableCell>
            <TableCell className="text-right">
              <div className="font-mono text-[12px] text-[var(--foreground)]">
                {formatCost(event.cost_usd)}
              </div>
              <div className="font-mono text-[10px] text-[var(--foreground-dim)]">
                {formatTokens(event.total_tokens)}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                {event.route_decision_link ? (
                  <Link
                    to={event.route_decision_link}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[var(--background-secondary)] px-2 text-[11px] font-semibold text-[var(--foreground-muted)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_10px_24px_rgba(5,46,36,0.10)]"
                  >
                    <Route className="h-3 w-3" />
                    {t('sessions.timeline.routeDecision')}
                  </Link>
                ) : (
                  <Badge variant="zinc">{t('sessions.timeline.noTrace')}</Badge>
                )}
                {event.shadow.count > 0 && (
                  <Badge variant="blue">
                    {t('sessions.timeline.shadow', { count: event.shadow.count })}
                  </Badge>
                )}
                {event.guardrails.count > 0 && (
                  <Badge variant="amber">
                    {t('sessions.timeline.guardrails', { count: event.guardrails.count })}
                  </Badge>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SessionsPage() {
  const { t } = useTranslation('dashboard')
  const { sessionId } = useParams()
  const [period, setPeriod] = useState('24h')
  const [apiKeyId, setApiKeyId] = useState('')
  const [namespaceId, setNamespaceId] = useState('')
  const [sourceFormat, setSourceFormat] = useState('')
  const [modelFilter, setModelFilter] = useState('')

  const filters = useMemo(
    () => ({
      period,
      api_key_id: apiKeyId,
      namespace: namespaceId,
      source_format: sourceFormat,
      model: modelFilter.trim(),
    }),
    [apiKeyId, modelFilter, namespaceId, period, sourceFormat],
  )

  const sessions = useSessions(1, LIMIT, filters)
  const selectedSessionId = sessionId || sessions.data?.data[0]?.session_id
  const detail = useSessionDetail(selectedSessionId, filters)
  const apiKeys = useApiKeys()
  const namespaces = useNamespaces()

  const namespaceOptions = [
    { value: '', label: t('sessions.filters.allNamespaces') },
    ...(namespaces.data?.namespaces || []).map((namespace) => ({
      value: namespace.id,
      label: namespace.name || namespace.id,
    })),
  ]
  const apiKeyOptions = [
    { value: '', label: t('sessions.filters.allApiKeys') },
    ...(apiKeys.data?.items || []).map((key) => ({
      value: key.id,
      label: key.name,
    })),
  ]

  const summary = detail.data?.summary
  const latestTraceRequestId = detail.data?.timeline
    .slice()
    .reverse()
    .find((event) => event.has_route_decision)?.request_id

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sessions.title')}
        description={t('sessions.description')}
        icon={Network}
        badge={
          <Badge variant="emerald" className="gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            {t('sessions.badges.metadataOnly')}
          </Badge>
        }
      />

      <CardStatic>
        <CardContent className="pt-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Select options={periodOptions(t)} value={period} onChange={setPeriod} />
            <Select options={namespaceOptions} value={namespaceId} onChange={setNamespaceId} />
            <Select options={apiKeyOptions} value={apiKeyId} onChange={setApiKeyId} />
            <Select options={sourceOptions(t)} value={sourceFormat} onChange={setSourceFormat} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--foreground-dim)]" />
              <Input
                className="pl-9"
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={t('sessions.filters.modelPlaceholder')}
              />
            </div>
          </div>
        </CardContent>
      </CardStatic>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {detail.isLoading && selectedSessionId ? (
          Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)
        ) : (
          <>
            <MetricCard
              label={t('sessions.metrics.requests')}
              value={formatNumber(summary?.request_count || 0)}
              subtitle={t('sessions.metrics.requestsSub', { sources: summary?.source_formats.length || 0 })}
              icon={Layers3}
            />
            <MetricCard
              label={t('sessions.metrics.cost')}
              value={formatCost(summary?.total_cost_usd || 0)}
              subtitle={formatTokens(summary?.total_tokens || 0)}
              icon={Wallet}
            />
            <MetricCard
              label={t('sessions.metrics.latency')}
              value={formatLatency(summary?.avg_latency_ms || 0)}
              subtitle={t('sessions.metrics.switches', { count: summary?.model_switch_count || 0 })}
              icon={Timer}
            />
            <MetricCard
              label={t('sessions.metrics.fallbacks')}
              value={formatNumber(summary?.fallback_count || 0)}
              subtitle={t('sessions.metrics.errors', { count: summary?.error_count || 0 })}
              icon={AlertTriangle}
            />
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('sessions.sections.sessions')}</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-[118px] animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : sessions.isError ? (
              <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
            ) : (sessions.data?.data.length || 0) === 0 ? (
              <EmptyState
                icon={Network}
                title={t('sessions.empty.listTitle')}
                description={t('sessions.empty.listDescription')}
              />
            ) : (
              <div className="space-y-3">
                {sessions.data?.data.map((session) => (
                  <SessionRow
                    key={session.session_id}
                    session={session}
                    selected={session.session_id === selectedSessionId}
                    t={t}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </CardStatic>

        <div className="space-y-5">
          <CardStatic>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>{t('sessions.sections.detail')}</CardTitle>
                  <div className="mt-1 font-mono text-[12px] text-[var(--foreground-dim)]">
                    {compactId(selectedSessionId)}
                  </div>
                </div>
                {latestTraceRequestId && (
                  <Link
                    to={`/route-decisions/${encodeURIComponent(latestTraceRequestId)}`}
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[var(--background-secondary)] px-3 text-xs font-semibold text-[var(--foreground-muted)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all hover:-translate-y-0.5 hover:text-[var(--foreground)] hover:shadow-[0_14px_32px_rgba(5,46,36,0.10)]"
                  >
                    <GitBranch className="h-4 w-4" />
                    {t('sessions.actions.latestRoute')}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {detail.isLoading && selectedSessionId ? (
                <SkeletonTable rows={6} cols={6} />
              ) : detail.isError ? (
                <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
              ) : !selectedSessionId ? (
                <EmptyState
                  icon={Network}
                  title={t('sessions.empty.noSelectionTitle')}
                  description={t('sessions.empty.noSelectionDescription')}
                />
              ) : detail.data ? (
                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryPill
                      label={t('sessions.detail.firstSeen')}
                      value={detail.data.summary.first_seen_at ? formatDate(detail.data.summary.first_seen_at) : '-'}
                    />
                    <SummaryPill
                      label={t('sessions.detail.lastSeen')}
                      value={detail.data.summary.last_seen_at ? formatDate(detail.data.summary.last_seen_at) : '-'}
                    />
                    <SummaryPill
                      label={t('sessions.detail.traceIds')}
                      value={formatNumber(detail.data.summary.trace_ids.length)}
                    />
                    <SummaryPill
                      label={t('sessions.detail.routeLinks')}
                      value={formatNumber(detail.data.links.route_decisions)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.summary.models.slice(0, 6).map((model) => (
                      <Badge key={model} variant="blue">
                        {model}
                      </Badge>
                    ))}
                    {detail.data.summary.nodes.slice(0, 6).map((node) => (
                      <Badge key={node} variant="gold">
                        {node}
                      </Badge>
                    ))}
                    <Badge variant="emerald" className="gap-1.5">
                      <Clock3 className="h-3 w-3" />
                      {detail.data.filters.period}
                    </Badge>
                  </div>
                  <TimelineTable events={detail.data.timeline} t={t} />
                </div>
              ) : null}
            </CardContent>
          </CardStatic>
        </div>
      </div>
    </div>
  )
}

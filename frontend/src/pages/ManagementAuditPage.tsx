import { useMemo, useState } from 'react'
import {
  CircleAlert,
  FileSearch,
  Filter,
  Fingerprint,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useManagementAuditEvents } from '@/hooks/use-management-audit'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import type { ManagementAuditEvent, ManagementAuditResult } from '@/types/api'

const EVENT_LIMIT = 100

const resultVariants: Record<ManagementAuditResult, 'emerald' | 'red' | 'amber'> = {
  success: 'emerald',
  failure: 'red',
  denied: 'amber',
}

function labelFromKey(value: string | null | undefined, prefix: string, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!value) return t('audit.values.none')
  const normalized = value.replaceAll('.', '_').replaceAll('-', '_')
  return t(`${prefix}.${normalized}`, {
    defaultValue: value.replaceAll('_', ' '),
  })
}

function shortHash(value: string | null | undefined) {
  return value ? value.slice(0, 12) : '-'
}

function nonEmptySummary(summary: Record<string, unknown>) {
  return Object.keys(summary || {}).length > 0
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[220px] overflow-auto rounded-lg bg-[var(--inset-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--foreground-muted)]">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  )
}

function AuditEventRow({
  event,
  selected,
  onSelect,
}: {
  event: ManagementAuditEvent
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('dashboard')
  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={onSelect}
    >
      <TableCell>
        <div className="min-w-[180px]">
          <div className="font-mono text-[12px] font-bold text-[var(--foreground)]">
            {event.event_id}
          </div>
          <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
            {formatDate(event.timestamp)}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="min-w-[160px] text-[12px] font-semibold text-[var(--foreground)]">
          {labelFromKey(event.action, 'audit.actions', t)}
        </div>
        <div className="mt-1 font-mono text-[11px] text-[var(--foreground-dim)]">
          {event.action}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={resultVariants[event.result]}>
          {t(`audit.results.${event.result}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="font-mono text-[12px] text-[var(--foreground-muted)]">
          {event.resource_type}
        </div>
        <div className="mt-1 max-w-[180px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
          {event.resource_id || t('audit.values.none')}
        </div>
      </TableCell>
      <TableCell>
        <div className="font-mono text-[12px] text-[var(--foreground-muted)]">
          {event.actor_id}
        </div>
        <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
          {labelFromKey(event.actor_type, 'audit.actorTypes', t)}
        </div>
      </TableCell>
      <TableCell className="max-w-[240px]">
        <div className={cn('truncate text-[12px]', event.failure_reason ? 'text-red-600 dark:text-red-300' : 'text-[var(--foreground-dim)]')}>
          {event.failure_reason || event.request_id || t('audit.values.none')}
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ManagementAuditPage() {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation('common')
  const [result, setResult] = useState<ManagementAuditResult | ''>('')
  const [action, setAction] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [actorId, setActorId] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>()

  const events = useManagementAuditEvents({
    limit: EVENT_LIMIT,
    result,
    action: action.trim() || undefined,
    resourceType: resourceType.trim() || undefined,
    actorId: actorId.trim() || undefined,
  })

  const selectedEvent = useMemo(() => {
    const items = events.data?.data || []
    return items.find((item) => item.event_id === selectedEventId) || items[0]
  }, [events.data, selectedEventId])

  const counts = useMemo(() => {
    const items = events.data?.data || []
    return {
      total: events.data?.pagination.count ?? items.length,
      denied: items.filter((item) => item.result === 'denied').length,
      failure: items.filter((item) => item.result === 'failure').length,
      hashChain: items.filter((item) => item.event_hash).length,
    }
  }, [events.data])

  const refresh = () => void events.refetch()
  const clearFilters = () => {
    setResult('')
    setAction('')
    setResourceType('')
    setActorId('')
  }

  return (
    <div>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.description')}
        icon={FileSearch}
        badge={
          <Badge variant="emerald" className="gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            {t('audit.badge.metadataOnly')}
          </Badge>
        }
      >
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCcw className="h-4 w-4" />
          {tc('action.refresh')}
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <CardStatic>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
                {t('audit.metrics.events')}
              </div>
              <FileSearch className="h-4 w-4 text-[var(--foreground-dim)]" />
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {formatNumber(counts.total)}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
                {t('audit.metrics.denied')}
              </div>
              <LockKeyhole className="h-4 w-4 text-[var(--foreground-dim)]" />
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {formatNumber(counts.denied)}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
                {t('audit.metrics.failures')}
              </div>
              <CircleAlert className="h-4 w-4 text-[var(--foreground-dim)]" />
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {formatNumber(counts.failure)}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
                {t('audit.metrics.hashChain')}
              </div>
              <Fingerprint className="h-4 w-4 text-[var(--foreground-dim)]" />
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {formatNumber(counts.hashChain)}
            </div>
          </CardContent>
        </CardStatic>
      </div>

      <CardStatic className="mt-5">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>{t('audit.sections.filters')}</CardTitle>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <Filter className="h-4 w-4" />
              {t('audit.filters.clear')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Select
              value={result}
              onChange={(value) => setResult(value as ManagementAuditResult | '')}
              options={[
                { value: '', label: t('audit.filters.allResults') },
                { value: 'success', label: t('audit.results.success') },
                { value: 'failure', label: t('audit.results.failure') },
                { value: 'denied', label: t('audit.results.denied') },
              ]}
            />
            <Input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder={t('audit.filters.actionPlaceholder')}
            />
            <Input
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value)}
              placeholder={t('audit.filters.resourcePlaceholder')}
            />
            <Input
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
              placeholder={t('audit.filters.actorPlaceholder')}
            />
          </div>
        </CardContent>
      </CardStatic>

      {events.error ? (
        <ErrorState error={events.error as Error} onRetry={refresh} />
      ) : (
        <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <CardStatic>
            <CardHeader>
              <CardTitle>{t('audit.sections.events')}</CardTitle>
            </CardHeader>
            <CardContent>
              {events.isLoading ? (
                <SkeletonTable rows={6} cols={6} />
              ) : events.data?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('audit.table.event')}</TableHead>
                      <TableHead>{t('audit.table.action')}</TableHead>
                      <TableHead>{t('audit.table.result')}</TableHead>
                      <TableHead>{t('audit.table.resource')}</TableHead>
                      <TableHead>{t('audit.table.actor')}</TableHead>
                      <TableHead>{t('audit.table.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.data.data.map((event) => (
                      <AuditEventRow
                        key={event.event_id}
                        event={event}
                        selected={event.event_id === selectedEvent?.event_id}
                        onSelect={() => setSelectedEventId(event.event_id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={FileSearch}
                  title={t('audit.empty.title')}
                  description={t('audit.empty.description')}
                />
              )}
            </CardContent>
          </CardStatic>

          <CardStatic>
            <CardHeader>
              <CardTitle>{t('audit.sections.detail')}</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedEvent ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                    <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                        {t('audit.detail.requestId')}
                      </div>
                      <div className="mt-1 truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">
                        {selectedEvent.request_id || t('audit.values.none')}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                        {t('audit.detail.hash')}
                      </div>
                      <div className="mt-1 font-mono text-[12px] font-semibold text-[var(--foreground)]">
                        {shortHash(selectedEvent.event_hash)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                      {t('audit.detail.chain')}
                    </div>
                    <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2 2xl:grid-cols-1">
                      <div>
                        <span className="text-[var(--foreground-dim)]">{t('audit.detail.previous')}</span>
                        <div className="font-mono text-[var(--foreground-muted)]">{shortHash(selectedEvent.previous_hash)}</div>
                      </div>
                      <div>
                        <span className="text-[var(--foreground-dim)]">{t('audit.detail.current')}</span>
                        <div className="font-mono text-[var(--foreground-muted)]">{shortHash(selectedEvent.event_hash)}</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                      {t('audit.detail.before')}
                    </div>
                    {nonEmptySummary(selectedEvent.before_summary) ? (
                      <JsonPreview value={selectedEvent.before_summary} />
                    ) : (
                      <div className="rounded-lg bg-[var(--inset-bg)] px-3 py-2 text-[12px] text-[var(--foreground-dim)]">
                        {t('audit.values.none')}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                      {t('audit.detail.after')}
                    </div>
                    {nonEmptySummary(selectedEvent.after_summary) ? (
                      <JsonPreview value={selectedEvent.after_summary} />
                    ) : (
                      <div className="rounded-lg bg-[var(--inset-bg)] px-3 py-2 text-[12px] text-[var(--foreground-dim)]">
                        {t('audit.values.none')}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg bg-[var(--accent-muted)] px-3 py-2 text-[12px] font-medium text-[var(--foreground-muted)]">
                    {t('audit.privacy.metadataOnly')}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={FileSearch}
                  title={t('audit.empty.detailTitle')}
                  description={t('audit.empty.detailDescription')}
                />
              )}
            </CardContent>
          </CardStatic>
        </div>
      )}
    </div>
  )
}

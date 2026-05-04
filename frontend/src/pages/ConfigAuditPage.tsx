import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileClock, RefreshCcw, ShieldCheck, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useConfigAuditEvents,
  useConfigVersion,
  useConfigVersions,
  useRollbackConfigVersion,
} from '@/hooks/use-config-audit'
import { cn, formatDate } from '@/lib/utils'
import type { ConfigAuditEvent, ConfigVersionSummary } from '@/types/api'

const VERSION_LIMIT = 50
const EVENT_LIMIT = 100

function labelFromKey(value: string | null | undefined, prefix: string, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!value) return t('configAudit.values.unknown')
  const normalized = value.replaceAll('.', '_').replaceAll('-', '_')
  return t(`${prefix}.${normalized}`, {
    defaultValue: value.replaceAll('_', ' '),
  })
}

function sourceVariant(source: string) {
  if (source === 'rollback') return 'amber'
  if (source === 'system') return 'blue'
  if (source === 'cli') return 'purple'
  return 'emerald'
}

function resultVariant(result: ConfigAuditEvent['result']) {
  return result === 'success' ? 'emerald' : 'red'
}

function shortChecksum(checksum: string) {
  return checksum ? checksum.slice(0, 12) : '-'
}

function summaryValue(summary: Record<string, unknown> | undefined, key: string) {
  const value = summary?.[key]
  if (typeof value === 'number') return value
  if (Array.isArray(value)) return value.length
  return 0
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-lg bg-[var(--inset-bg)] p-4 font-mono text-[11px] leading-5 text-[var(--foreground-muted)]">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  )
}

function VersionSummary({
  version,
  selected,
  onSelect,
}: {
  version: ConfigVersionSummary
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('dashboard')
  return (
    <TableRow
      className={cn('cursor-pointer', selected && 'bg-[var(--accent-muted)]')}
      onClick={onSelect}
    >
      <TableCell>
        <div className="min-w-[150px]">
          <div className="font-mono text-[12px] font-bold text-[var(--foreground)]">
            {version.version_id}
          </div>
          <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
            {formatDate(version.created_at)}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={sourceVariant(version.source)}>
          {labelFromKey(version.source, 'configAudit.sources', t)}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-[12px] text-[var(--foreground-muted)]">
        {shortChecksum(version.checksum)}
      </TableCell>
      <TableCell>
        <div className="text-[12px] font-semibold text-[var(--foreground)]">
          {version.node_count}
        </div>
        <div className="max-w-[220px] truncate text-[11px] text-[var(--foreground-dim)]">
          {version.node_ids.length > 0 ? version.node_ids.join(', ') : t('configAudit.values.none')}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AuditEventRow({ event }: { event: ConfigAuditEvent }) {
  const { t } = useTranslation('dashboard')
  return (
    <TableRow>
      <TableCell>
        <div className="font-mono text-[12px] font-bold text-[var(--foreground)]">
          {event.event_id}
        </div>
        <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
          {formatDate(event.timestamp)}
        </div>
      </TableCell>
      <TableCell>
        <div className="text-[12px] font-semibold text-[var(--foreground)]">
          {labelFromKey(event.action, 'configAudit.actions', t)}
        </div>
        <div className="mt-1 font-mono text-[11px] text-[var(--foreground-dim)]">
          {event.target}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={resultVariant(event.result)}>
          {t(`configAudit.results.${event.result}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-[12px] text-[var(--foreground-muted)]">
        {event.actor}
      </TableCell>
      <TableCell className="max-w-[280px] text-[12px] text-[var(--foreground-dim)]">
        {event.failure_reason || event.version_id || t('configAudit.values.none')}
      </TableCell>
    </TableRow>
  )
}

export function ConfigAuditPage() {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation('common')
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>()
  const [rollbackTarget, setRollbackTarget] = useState<ConfigVersionSummary | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null)

  const versions = useConfigVersions(VERSION_LIMIT)
  const events = useConfigAuditEvents(EVENT_LIMIT)
  const detail = useConfigVersion(selectedVersionId)
  const rollback = useRollbackConfigVersion()

  useEffect(() => {
    if (!selectedVersionId && versions.data?.data?.[0]) {
      setSelectedVersionId(versions.data.data[0].version_id)
    }
  }, [selectedVersionId, versions.data])

  const selectedVersion = useMemo(
    () => versions.data?.data.find((item) => item.version_id === selectedVersionId),
    [selectedVersionId, versions.data],
  )

  const latest = versions.data?.data?.[0]
  const totalEvents = events.data?.pagination.count ?? 0
  const latestSummary = latest?.sanitized_summary

  const refreshAll = () => {
    void versions.refetch()
    void events.refetch()
    void detail.refetch()
  }

  const confirmRollback = async () => {
    if (!rollbackTarget) return
    setRollbackMessage(null)
    const result = await rollback.mutateAsync({
      versionId: rollbackTarget.version_id,
      reason: rollbackReason.trim() || undefined,
    })
    setRollbackMessage(result.message)
    setRollbackTarget(null)
    setRollbackReason('')
  }

  const loading = versions.isLoading || events.isLoading
  const blockingError = versions.error || events.error

  return (
    <div>
      <PageHeader
        title={t('configAudit.title')}
        description={t('configAudit.description')}
        icon={FileClock}
        badge={
          <Badge variant="emerald" className="gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            {t('configAudit.badge.localOnly')}
          </Badge>
        }
      >
        <Button variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCcw className="h-4 w-4" />
          {tc('action.refresh')}
        </Button>
      </PageHeader>

      {rollbackMessage && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-4 py-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {rollbackMessage}
        </div>
      )}
      {rollback.error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/10 px-4 py-3 text-[13px] font-semibold text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          {(rollback.error as Error).message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <CardStatic>
          <CardContent className="pt-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
              {t('configAudit.metrics.versions')}
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {versions.data?.pagination.count ?? 0}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
              {t('configAudit.metrics.auditEvents')}
            </div>
            <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
              {totalEvents}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
              {t('configAudit.metrics.latestSource')}
            </div>
            <div className="mt-3">
              {latest ? (
                <Badge variant={sourceVariant(latest.source)}>
                  {labelFromKey(latest.source, 'configAudit.sources', t)}
                </Badge>
              ) : (
                <span className="text-[13px] text-[var(--foreground-dim)]">{t('configAudit.values.none')}</span>
              )}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
              {t('configAudit.metrics.currentShape')}
            </div>
            <div className="mt-2 text-[13px] font-semibold text-[var(--foreground)]">
              {t('configAudit.metrics.nodesAndKeys', {
                nodes: summaryValue(latestSummary, 'node_count'),
                keys: summaryValue(latestSummary, 'api_key_count'),
              })}
            </div>
          </CardContent>
        </CardStatic>
      </div>

      {blockingError ? (
        <ErrorState error={blockingError as Error} onRetry={refreshAll} />
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
          <CardStatic>
            <CardHeader>
              <CardTitle>{t('configAudit.sections.versions')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <SkeletonTable rows={6} cols={4} />
              ) : versions.data?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('configAudit.table.version')}</TableHead>
                      <TableHead>{t('configAudit.table.source')}</TableHead>
                      <TableHead>{t('configAudit.table.checksum')}</TableHead>
                      <TableHead>{t('configAudit.table.nodes')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.data.data.map((version) => (
                      <VersionSummary
                        key={version.version_id}
                        version={version}
                        selected={version.version_id === selectedVersionId}
                        onSelect={() => setSelectedVersionId(version.version_id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={FileClock}
                  title={t('configAudit.empty.versionsTitle')}
                  description={t('configAudit.empty.versionsDescription')}
                />
              )}
            </CardContent>
          </CardStatic>

          <CardStatic>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{t('configAudit.sections.versionDetail')}</CardTitle>
                  <div className="mt-1 text-[12px] text-[var(--foreground-dim)]">
                    {selectedVersionId || t('configAudit.values.none')}
                  </div>
                </div>
                {selectedVersion && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRollbackTarget(selectedVersion)
                      setRollbackReason('')
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                    {t('configAudit.rollback.open')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedVersionId ? (
                <EmptyState
                  icon={FileClock}
                  title={t('configAudit.empty.noSelectionTitle')}
                  description={t('configAudit.empty.noSelectionDescription')}
                />
              ) : detail.isLoading ? (
                <div className="space-y-3">
                  <div className="h-4 w-1/2 animate-shimmer rounded-lg" />
                  <div className="h-[360px] animate-shimmer rounded-lg" />
                </div>
              ) : detail.error ? (
                <ErrorState error={detail.error as Error} onRetry={() => void detail.refetch()} />
              ) : detail.data ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                        {t('configAudit.detail.createdBy')}
                      </div>
                      <div className="mt-1 truncate text-[12px] font-semibold text-[var(--foreground)]">
                        {detail.data.created_by}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                        {t('configAudit.detail.runtimeVersion')}
                      </div>
                      <div className="mt-1 font-mono text-[12px] font-semibold text-[var(--foreground)]">
                        {detail.data.runtime_version}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                        {t('configAudit.detail.secrets')}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-[var(--foreground)]">
                        {t('configAudit.detail.redacted')}
                      </div>
                    </div>
                  </div>
                  <JsonPreview value={detail.data.sanitized_config} />
                  <div className="rounded-lg bg-[var(--accent-muted)] px-3 py-2 text-[12px] font-medium text-[var(--foreground-muted)]">
                    {detail.data.privacy.snapshot_storage}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </CardStatic>
        </div>
      )}

      <CardStatic className="mt-5">
        <CardHeader>
          <CardTitle>{t('configAudit.sections.auditEvents')}</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isLoading ? (
            <SkeletonTable rows={6} cols={5} />
          ) : events.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('configAudit.table.event')}</TableHead>
                  <TableHead>{t('configAudit.table.action')}</TableHead>
                  <TableHead>{t('configAudit.table.result')}</TableHead>
                  <TableHead>{t('configAudit.table.actor')}</TableHead>
                  <TableHead>{t('configAudit.table.reason')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.data.map((event) => (
                  <AuditEventRow key={event.event_id} event={event} />
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={FileClock}
              title={t('configAudit.empty.eventsTitle')}
              description={t('configAudit.empty.eventsDescription')}
            />
          )}
        </CardContent>
      </CardStatic>

      <Dialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open && !rollback.isPending) setRollbackTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('configAudit.rollback.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-300">
              {t('configAudit.rollback.warning', {
                version: rollbackTarget?.version_id,
              })}
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-[var(--foreground-muted)]">
                {t('configAudit.rollback.reasonLabel')}
              </label>
              <Input
                value={rollbackReason}
                onChange={(event) => setRollbackReason(event.target.value)}
                placeholder={t('configAudit.rollback.reasonPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRollbackTarget(null)}
              disabled={rollback.isPending}
            >
              {tc('action.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRollback()}
              disabled={rollback.isPending}
            >
              <Undo2 className="h-4 w-4" />
              {rollback.isPending ? t('configAudit.rollback.running') : t('configAudit.rollback.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

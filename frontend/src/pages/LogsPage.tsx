import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Radio, Download, ScrollText, Route } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { Card, CardStatic } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useLogs } from '@/hooks/use-logs'
import { useSSELogs } from '@/hooks/use-sse-logs'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useNamespaces } from '@/hooks/use-namespaces'
import { formatTimestamp, formatTokens, formatCost, formatLatency } from '@/lib/utils'
import { isPromptCacheLog, sourceFormatLabel } from '@/lib/call-log-display'
import { getAuthToken } from '@/contexts/AuthContext'
import type { CallLog } from '@/types/api'

const LIMIT = 20

function formatBytes(value?: number | null) {
  if (value === null || value === undefined) return null
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function LogRouteBadge({ log }: { log: CallLog }) {
  const { t } = useTranslation('logs')
  if (isPromptCacheLog(log)) {
    return <Badge variant="emerald">{t('cache.hit')}</Badge>
  }
  return <TierBadge tier={log.tier} />
}

function SourceBadge({ sourceFormat }: { sourceFormat: string }) {
  const { t } = useTranslation('logs')
  return (
    <Badge variant="blue" className="max-w-[150px] truncate whitespace-nowrap">
      {sourceFormatLabel(sourceFormat, t)}
    </Badge>
  )
}

function UpstreamCell({ log }: { log: CallLog }) {
  const { t } = useTranslation('logs')
  if (isPromptCacheLog(log)) {
    return (
      <div className="min-w-0">
        <span className="font-medium text-[var(--foreground-dim)]">{t('cache.noUpstream')}</span>
        <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">{t('cache.promptCache')}</div>
      </div>
    )
  }
  return <span className="font-medium text-[var(--foreground)]">{log.node_id}</span>
}

function LogDetailRow({ log }: { log: CallLog }) {
  const { t } = useTranslation('logs')
  const mediaByteSize = formatBytes(log.media_byte_size)
  const isCache = isPromptCacheLog(log)
  return (
    <TableRow>
      <TableCell colSpan={10} className="bg-[var(--inset-bg)] px-6 py-4">
        <div className="grid gap-4 text-xs md:grid-cols-2 xl:grid-cols-3">
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.requestId')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.request_id}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.score')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.score?.toFixed(3) ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.sourceFormat')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {sourceFormatLabel(log.source_format, t)}
            </span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.routeResult')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {isCache ? t('cache.hit') : t(`tiers.${log.tier}`, { defaultValue: log.tier })}
            </span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.upstream')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {isCache ? t('cache.noUpstream') : log.node_id}
            </span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.apiKey')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.api_key_name ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.namespace')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.namespace_id ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.sessionKey')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.session_key ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.fallback')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.is_fallback ? t('common.yes') : t('common.no')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.fallbackReason')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.fallback_reason ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.structuredOutput')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.structured_output_requested ? t('common.yes') : t('common.no')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.structuredOutputType')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.structured_output_type ?? t('common.na')}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.structuredOutputStrategy')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {log.structured_output_strategy ?? t('common.na')}
              {log.structured_output_supported === false ? ` / ${t('detail.unsupported')}` : ''}
            </span>
          </div>
          {log.media_type && (
            <>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.mediaOperation')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">
                  {log.media_type}/{log.media_operation ?? t('common.na')}
                </span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.mediaBytes')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{mediaByteSize ?? t('common.na')}</span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.providerResponseType')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{log.media_provider_response_type ?? t('common.na')}</span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.mediaFiles')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">
                  {t('detail.mediaFilesValue', {
                    count: log.media_file_count ?? 0,
                    multipart: log.media_multipart ? t('common.yes') : t('common.no'),
                  })}
                </span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.requestedFormat')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{log.media_requested_format ?? t('common.na')}</span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('detail.responseFormat')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{log.media_response_format ?? t('common.na')}</span>
              </div>
            </>
          )}
          {(isCache || log.cache_creation_input_tokens || log.cache_read_input_tokens) && (
            <>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('cache.kind')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">
                  {isCache ? t('cache.promptCache') : t('cache.providerCache')}
                </span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('cache.readTokens')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{log.cache_read_input_tokens ?? 0}</span>
              </div>
              <div>
                <span className="text-[var(--foreground-dim)]">{t('cache.creationTokens')}: </span>
                <span className="font-mono text-[var(--foreground-muted)]">{log.cache_creation_input_tokens ?? 0}</span>
              </div>
            </>
          )}
          <div>
            <span className="text-[var(--foreground-dim)]">{t('detail.tokens')}: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {t('detail.tokensInOut', { input: log.input_tokens, output: log.output_tokens })}
            </span>
          </div>
          {log.error && (
            <div className="col-span-3">
              <span className="text-[var(--foreground-dim)]">{t('detail.error')}: </span>
              <span className="font-mono text-red-600 dark:text-red-400">{log.error}</span>
            </div>
          )}
          <div className="md:col-span-2 xl:col-span-3">
            <Link
              to={`/route-decisions/${encodeURIComponent(log.request_id)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-1' })}
            >
              <Route className="h-3.5 w-3.5" />
              {t('detail.explainRoute')}
            </Link>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function LogsPage() {
  const { t } = useTranslation('logs')
  const [page, setPage] = useState(1)
  const [tierFilter, setTierFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [exportFormat, setExportFormat] = useState('csv')
  const [exportDays, setExportDays] = useState('7')

  const { data: apiKeysData } = useApiKeys()
  const { data: namespacesData } = useNamespaces()
  const tierOptions = [
    { value: '', label: t('filters.allTiers') },
    { value: 'simple', label: t('tiers.simple') },
    { value: 'standard', label: t('tiers.standard') },
    { value: 'complex', label: t('tiers.complex') },
    { value: 'reasoning', label: t('tiers.reasoning') },
  ]
  const statusOptions = [
    { value: '', label: t('filters.allStatus') },
    { value: '200', label: t('filters.status200') },
    { value: '500', label: t('filters.status500') },
    { value: '429', label: t('filters.status429') },
  ]
  const exportFormatOptions = [
    { value: 'csv', label: t('export.csv') },
    { value: 'json', label: t('export.json') },
  ]
  const exportDaysOptions = [
    { value: '7', label: t('export.days', { count: 7 }) },
    { value: '30', label: t('export.days', { count: 30 }) },
    { value: '90', label: t('export.days', { count: 90 }) },
  ]
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

  const { data: logsData, isLoading, isError, error, refetch } = useLogs(page, LIMIT, {
    tier: tierFilter || undefined,
    node: nodeFilter || undefined,
    status: statusFilter || undefined,
    api_key_id: apiKeyFilter || undefined,
    namespace: namespaceFilter || undefined,
  })

  const { newCount, clearNewCount } = useSSELogs(100)

  const handleRefresh = () => {
    clearNewCount()
    refetch()
  }

  const handleExport = () => {
    const token = getAuthToken()
    const params = new URLSearchParams({ format: exportFormat, days: exportDays })
    if (apiKeyFilter) params.set('api_key_id', apiKeyFilter)
    if (namespaceFilter) params.set('namespace', namespaceFilter)
    const url = `/api/dashboard/logs/export?${params.toString()}`
    // Use a hidden link with auth header via fetch + blob download
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `logs-${exportDays}d.${exportFormat}`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => {})
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('logs.title')}
        description={t('logs.description')}
        icon={ScrollText}
      >
        <div className="flex items-center gap-2">
          <Select
            options={exportDaysOptions}
            value={exportDays}
            onChange={(v) => setExportDays(v)}
            className="w-24 h-8 text-[11px]"
          />
          <Select
            options={exportFormatOptions}
            value={exportFormat}
            onChange={(v) => setExportFormat(v)}
            className="w-20 h-8 text-[11px]"
          />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            {t('export.button')}
          </Button>
        </div>
      </PageHeader>

      {/* SSE New Logs Banner */}
      {newCount > 0 && (
        <button
          onClick={handleRefresh}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-[var(--sse-border)] bg-[var(--sse-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--sse-text)] transition-all duration-300 hover:opacity-80 cursor-pointer"
          style={{ boxShadow: '0 0 24px var(--accent-glow)' }}
        >
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          {t('sse.newLogsReceived', { count: newCount })}
        </button>
      )}

      {/* Filters */}
      <CardStatic className="animate-fade-up p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            options={tierOptions}
            value={tierFilter}
            onChange={(v) => {
              setTierFilter(v)
              setPage(1)
            }}
            className="w-36"
          />
          <Input
            placeholder={t('filters.nodePlaceholder')}
            value={nodeFilter}
            onChange={(e) => {
              setNodeFilter(e.target.value)
              setPage(1)
            }}
            className="w-40"
          />
          <Select
            options={statusOptions}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
            className="w-36"
          />
          <Select
            options={apiKeyOptions}
            value={apiKeyFilter}
            onChange={(v) => {
              setApiKeyFilter(v)
              setPage(1)
            }}
            className="w-36"
          />
          <Select
            options={namespaceOptions}
            value={namespaceFilter}
            onChange={(v) => {
              setNamespaceFilter(v)
              setPage(1)
            }}
            className="w-40"
          />
          <div className="ml-auto font-mono text-[11px] text-[var(--foreground-dim)]">
            {logsData?.pagination
              ? t('pagination.totalLogs', { count: logsData.pagination.total })
              : '...'}
          </div>
        </div>
      </CardStatic>

      {/* Table */}
      <CardStatic className="animate-fade-up" style={{ animationDelay: '80ms' }}>
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <SkeletonTable rows={10} cols={10} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('table.time')}</TableHead>
                  <TableHead>{t('table.source')}</TableHead>
                  <TableHead>{t('table.routeResult')}</TableHead>
                  <TableHead>{t('table.upstream')}</TableHead>
                  <TableHead>{t('table.model')}</TableHead>
                  <TableHead className="text-right">{t('table.tokens')}</TableHead>
                  <TableHead className="text-right">{t('table.cost')}</TableHead>
                  <TableHead className="text-right">{t('table.latency')}</TableHead>
                  <TableHead className="text-right">{t('table.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData?.data.map((log) => (
                  <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                    >
                      <TableCell>
                        {expandedId === log.id ? (
                          <ChevronUp className="h-3.5 w-3.5 text-[var(--foreground-dim)]" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-[var(--foreground-dim)]" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatTimestamp(log.timestamp)}
                      </TableCell>
                      <TableCell>
                        <SourceBadge sourceFormat={log.source_format} />
                      </TableCell>
                      <TableCell>
                        <LogRouteBadge log={log} />
                      </TableCell>
                      <TableCell className="max-w-[160px]">
                        <UpstreamCell log={log} />
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                        <Tooltip content={log.model}>
                          <span className="block truncate">{log.model}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatTokens(log.input_tokens + log.output_tokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatCost(log.cost_usd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatLatency(log.latency_ms)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-mono text-[11px] font-semibold ${
                            log.status_code === 200
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {log.status_code}
                        </span>
                      </TableCell>
                    </TableRow>
                    {expandedId === log.id && (
                      <LogDetailRow key={`detail-${log.id}`} log={log} />
                    )}
                  </Fragment>
                ))}
                {(!logsData?.data || logsData.data.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={10} className="p-0">
                      <EmptyState
                        icon={ScrollText}
                        title={t('empty.title')}
                        description={t('empty.description')}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {logsData?.pagination && logsData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
                <div className="font-mono text-[11px] text-[var(--foreground-dim)]">
                  {t('pagination.pageOf', {
                    page: logsData.pagination.page,
                    totalPages: logsData.pagination.totalPages,
                  })}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t('pagination.prev')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= logsData.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('pagination.next')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardStatic>
    </div>
  )
}

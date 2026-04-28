import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Radio, Download } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { Card, CardStatic } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
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
import { formatTimestamp, formatTokens, formatCost, formatLatency } from '@/lib/utils'
import { getAuthToken } from '@/contexts/AuthContext'
import type { CallLog } from '@/types/api'

const LIMIT = 20

const tierOptions = [
  { value: '', label: 'All Tiers' },
  { value: 'simple', label: 'Simple' },
  { value: 'standard', label: 'Standard' },
  { value: 'complex', label: 'Complex' },
  { value: 'reasoning', label: 'Reasoning' },
]

const statusOptions = [
  { value: '', label: 'All Status' },
  { value: '200', label: '200 OK' },
  { value: '500', label: '500 Error' },
  { value: '429', label: '429 Rate Limit' },
]

const exportFormatOptions = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
]

const exportDaysOptions = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

function LogDetailRow({ log }: { log: CallLog }) {
  return (
    <TableRow>
      <TableCell colSpan={8} className="bg-[var(--inset-bg)] px-6 py-4">
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-[var(--foreground-dim)]">Request ID: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.request_id}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">Score: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.score?.toFixed(3) ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">Source Format: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.source_format}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">API Key: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.api_key_name ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">Session Key: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.session_key ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">Fallback: </span>
            <span className="font-mono text-[var(--foreground-muted)]">{log.is_fallback ? 'Yes' : 'No'}</span>
          </div>
          <div>
            <span className="text-[var(--foreground-dim)]">Tokens: </span>
            <span className="font-mono text-[var(--foreground-muted)]">
              {log.input_tokens} in / {log.output_tokens} out
            </span>
          </div>
          {log.error && (
            <div className="col-span-3">
              <span className="text-[var(--foreground-dim)]">Error: </span>
              <span className="font-mono text-red-600 dark:text-red-400">{log.error}</span>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export function LogsPage() {
  const [page, setPage] = useState(1)
  const [tierFilter, setTierFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [exportFormat, setExportFormat] = useState('csv')
  const [exportDays, setExportDays] = useState('7')

  const { data: apiKeysData } = useApiKeys()
  const apiKeyOptions = [
    { value: '', label: 'All API Keys' },
    ...(apiKeysData?.keys || []).map((k) => ({ value: k, label: k })),
  ]

  const { data: logsData, isLoading, refetch } = useLogs(page, LIMIT, {
    tier: tierFilter || undefined,
    node: nodeFilter || undefined,
    status: statusFilter || undefined,
    api_key: apiKeyFilter || undefined,
  })

  const { newCount, clearNewCount } = useSSELogs(100)

  const handleRefresh = () => {
    clearNewCount()
    refetch()
  }

  const handleExport = () => {
    const token = getAuthToken()
    const params = new URLSearchParams({ format: exportFormat, days: exportDays })
    if (apiKeyFilter) params.set('api_key', apiKeyFilter)
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
        title="Logs"
        description="Browse and filter call logs with real-time updates"
      >
        <div className="flex items-center gap-2">
          <Select
            options={exportDaysOptions}
            value={exportDays}
            onChange={(e) => setExportDays(e.target.value)}
            className="w-24 h-8 text-[11px]"
          />
          <Select
            options={exportFormatOptions}
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
            className="w-20 h-8 text-[11px]"
          />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Export
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
          {newCount} new log{newCount !== 1 ? 's' : ''} received — click to refresh
        </button>
      )}

      {/* Filters */}
      <CardStatic className="animate-fade-up p-4">
        <div className="flex items-center gap-3">
          <Select
            options={tierOptions}
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value)
              setPage(1)
            }}
            className="w-36"
          />
          <Input
            placeholder="Filter by node..."
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
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="w-36"
          />
          <Select
            options={apiKeyOptions}
            value={apiKeyFilter}
            onChange={(e) => {
              setApiKeyFilter(e.target.value)
              setPage(1)
            }}
            className="w-36"
          />
          <div className="ml-auto font-mono text-[11px] text-[var(--foreground-dim)]">
            {logsData?.pagination
              ? `${logsData.pagination.total} total logs`
              : '...'}
          </div>
        </div>
      </CardStatic>

      {/* Table */}
      <CardStatic className="animate-fade-up" style={{ animationDelay: '80ms' }}>
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="animate-shimmer h-4 w-32 rounded-lg" />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData?.data.map((log) => (
                  <>
                    <TableRow
                      key={log.id}
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
                        <TierBadge tier={log.tier} />
                      </TableCell>
                      <TableCell className="font-medium text-[var(--foreground)]">
                        {log.node_id}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                        {log.model}
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
                  </>
                ))}
                {(!logsData?.data || logsData.data.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-[var(--foreground-dim)]">
                      No logs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {logsData?.pagination && logsData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
                <div className="font-mono text-[11px] text-[var(--foreground-dim)]">
                  Page {logsData.pagination.page} of{' '}
                  {logsData.pagination.totalPages}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Prev
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= logsData.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
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

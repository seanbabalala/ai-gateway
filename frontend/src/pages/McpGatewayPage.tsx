import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, Network, RefreshCw, Server, ShieldCheck, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { MetricCard } from '@/components/shared/MetricCard'
import { SetupGuidePanel } from '@/components/shared/SetupGuidePanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMcpGateway } from '@/hooks/use-mcp'
import { cn, formatLatency, formatNumber } from '@/lib/utils'
import type { McpAuditEntry, McpServerSummary } from '@/types/api'

function formatBytes(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDateTime(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('dashboard')
  return <Badge variant={enabled ? 'emerald' : 'zinc'}>{enabled ? t('mcp.status.enabled') : t('mcp.status.disabled')}</Badge>
}

function ServerCard({ server }: { server: McpServerSummary }) {
  const { t } = useTranslation('dashboard')
  const errorRate = server.recent_calls > 0 ? (server.recent_errors / server.recent_calls) * 100 : 0

  return (
    <CardStatic>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="truncate">{server.name}</CardTitle>
            <StatusBadge enabled={server.enabled} />
            <Badge variant="blue">{server.transport}</Badge>
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--foreground-dim)]">{server.id}</div>
          {server.description && <p className="mt-2 text-[12px] text-[var(--foreground-dim)]">{server.description}</p>}
        </div>
        <div className="text-left md:text-right">
          <div className="font-mono text-[11px] text-[var(--foreground-muted)]">{server.endpoint}</div>
          <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
            {t('mcp.server.lastCall')}: {formatDateTime(server.last_called_at)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          <InlineMetric label={t('mcp.server.tools')} value={formatNumber(server.tools.length)} />
          <InlineMetric label={t('mcp.server.calls')} value={formatNumber(server.recent_calls)} />
          <InlineMetric label={t('mcp.server.errors')} value={formatNumber(server.recent_errors)} tone={server.recent_errors > 0 ? 'red' : 'default'} />
          <InlineMetric label={t('mcp.server.errorRate')} value={`${errorRate.toFixed(1)}%`} tone={errorRate > 0 ? 'amber' : 'default'} />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {server.allowed_namespaces.length > 0 ? (
            server.allowed_namespaces.map((namespace) => (
              <Badge key={namespace} variant="purple">
                {t('mcp.server.policyNamespaceValue', { namespace })}
              </Badge>
            ))
          ) : (
            <Badge variant="zinc">{t('mcp.server.allNamespaces')}</Badge>
          )}
          {server.tags.map((tag) => (
            <Badge key={tag} variant="zinc">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-bold uppercase text-[var(--foreground-dim)]">{t('mcp.server.toolsTitle')}</div>
          {server.tools.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[12px] text-[var(--foreground-dim)]">{t('mcp.server.noTools')}</div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {server.tools.map((tool) => (
                <div key={tool.name} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{tool.name}</div>
                    {tool.has_input_schema && (
                      <Badge variant="emerald" className="shrink-0">
                        {t('mcp.tool.schema')}
                      </Badge>
                    )}
                  </div>
                  {tool.description && <p className="mt-1 line-clamp-2 text-[12px] text-[var(--foreground-dim)]">{tool.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </CardStatic>
  )
}

function InlineMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'red' }) {
  return (
    <div className="rounded-lg bg-[var(--background-secondary)] p-3">
      <div className="text-[10px] font-bold uppercase text-[var(--foreground-dim)]">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-[16px] font-bold text-[var(--foreground)]',
          tone === 'amber' && 'text-amber-600 dark:text-amber-400',
          tone === 'red' && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </div>
    </div>
  )
}

const MCP_SETUP_SNIPPET = `mcp:
  enabled: true
  path: /mcp
  max_recent_calls: 100
  servers:
    - id: local-docs
      name: "Local Docs MCP"
      url: "http://localhost:8787/mcp"
      transport: http_json_rpc
      timeout_ms: 30000
      max_request_bytes: 1000000
      allowed_namespaces: [team-a]
      headers:
        Authorization: "Bearer \${env:LOCAL_DOCS_MCP_TOKEN}"
      tools:
        - name: search_docs
          description: "Search local product docs"
          input_schema:
            type: object

auth:
  api_keys:
    - key: "\${SIFTGATE_AGENT_KEY}"
      name: agent-tool-key
      namespace_id: team-a
      allowed_endpoints: [mcp:local-docs:search_docs]`

function RecentCallsTable({ calls }: { calls: McpAuditEntry[] }) {
  const { t } = useTranslation('dashboard')
  if (calls.length === 0) {
    return <EmptyState icon={Activity} title={t('mcp.empty.callsTitle')} description={t('mcp.empty.callsDescription')} />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('mcp.table.time')}</TableHead>
          <TableHead>{t('mcp.table.server')}</TableHead>
          <TableHead>{t('mcp.table.method')}</TableHead>
          <TableHead>{t('mcp.table.tool')}</TableHead>
          <TableHead>{t('mcp.table.scope')}</TableHead>
          <TableHead className="text-right">{t('mcp.table.status')}</TableHead>
          <TableHead className="text-right">{t('mcp.table.latency')}</TableHead>
          <TableHead className="text-right">{t('mcp.table.size')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((call) => (
          <TableRow key={call.id}>
            <TableCell className="whitespace-nowrap text-[12px] text-[var(--foreground-dim)]">{formatDateTime(call.timestamp)}</TableCell>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">{call.server_id}</div>
              <div className="text-[11px] text-[var(--foreground-dim)]">{call.server_name}</div>
            </TableCell>
            <TableCell className="font-mono text-[12px]">{call.method}</TableCell>
            <TableCell className="font-mono text-[12px]">{call.tool_name || '-'}</TableCell>
            <TableCell>
              <div className="text-[12px] text-[var(--foreground)]">{call.api_key_name || t('mcp.values.unknownKey')}</div>
              <div className="text-[11px] text-[var(--foreground-dim)]">
                {call.namespace_id
                  ? t('mcp.values.policyNamespaceValue', { namespace: call.namespace_id })
                  : t('mcp.values.noNamespace')}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <Badge variant={call.success ? 'emerald' : 'red'}>{call.status_code}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">{formatLatency(call.latency_ms)}</TableCell>
            <TableCell className="text-right font-mono text-[12px]">{formatBytes(call.request_bytes)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function McpGatewayPage() {
  const { t } = useTranslation('dashboard')
  const mcp = useMcpGateway()
  const data = mcp.data

  return (
    <div className="space-y-6">
      <PageHeader title={t('mcp.title')} description={t('mcp.description')} icon={Network} badge={data && <StatusBadge enabled={data.enabled} />}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void mcp.refetch()
          }}
          disabled={mcp.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', mcp.isFetching && 'animate-spin')} />
          {t('mcp.actions.refresh')}
        </Button>
      </PageHeader>

      <ConceptPanel
        conceptId="mcpToolGateway"
        icon={Network}
        badgeKinds={['runtimeSupported', 'configDriven', 'requiresConfig']}
      />

      {mcp.isLoading && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonTable rows={6} />
        </>
      )}

      {mcp.isError && (
        <ErrorState
          error={mcp.error instanceof Error ? mcp.error : new Error(t('mcp.error'))}
          onRetry={() => {
            void mcp.refetch()
          }}
        />
      )}

      {data && (
        <>
          <SetupGuidePanel
            title={t('mcp.setup.title')}
            description={t('mcp.setup.description')}
            icon={Wrench}
            statuses={[
              {
                label: t('mcp.setup.status.gateway'),
                value: data.enabled ? t('mcp.status.enabled') : t('mcp.status.disabled'),
                tone: data.enabled ? 'emerald' : 'zinc',
              },
              {
                label: t('mcp.setup.status.path'),
                value: data.path || '/mcp',
                tone: 'blue',
              },
              {
                label: t('mcp.setup.status.audit'),
                value: data.metadata_only ? t('mcp.setup.status.metadataOnly') : t('mcp.setup.status.reviewConfig'),
                tone: data.metadata_only ? 'emerald' : 'amber',
              },
            ]}
            bullets={[
              t('mcp.setup.bullets.toolProxy'),
              t('mcp.setup.bullets.notModelRouting'),
              t('mcp.setup.bullets.endpointPermissions'),
              t('mcp.setup.bullets.noPayloadStorage'),
            ]}
            snippetTitle={t('mcp.setup.snippetTitle')}
            snippet={MCP_SETUP_SNIPPET}
          />

          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              label={t('mcp.metrics.servers')}
              value={formatNumber(data.totals.servers)}
              subtitle={t('mcp.metrics.enabled', {
                count: data.totals.enabled_servers,
              })}
              icon={Server}
            />
            <MetricCard label={t('mcp.metrics.tools')} value={formatNumber(data.totals.tools)} subtitle={t('mcp.metrics.registry')} icon={Wrench} />
            <MetricCard label={t('mcp.metrics.calls')} value={formatNumber(data.totals.recent_calls)} subtitle={t('mcp.metrics.recent')} icon={Activity} />
            <MetricCard
              label={t('mcp.metrics.errors')}
              value={formatNumber(data.totals.recent_errors)}
              subtitle={t('mcp.metrics.metadataOnly')}
              icon={AlertTriangle}
            />
          </div>

          <CardStatic>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-4.5 w-4.5" />
                </div>
                <div>
                  <CardTitle>{t('mcp.privacy.title')}</CardTitle>
                  <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('mcp.privacy.description')}</p>
                </div>
              </div>
            </CardHeader>
          </CardStatic>

          {data.servers.length === 0 ? (
            <EmptyState icon={Network} title={t('mcp.empty.serversTitle')} description={t('mcp.empty.serversDescription')} />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.servers.map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <CardStatic>
              <CardHeader>
                <CardTitle>{t('mcp.sections.recentCalls')}</CardTitle>
              </CardHeader>
              <CardContent>
                <RecentCallsTable calls={data.recent_calls} />
              </CardContent>
            </CardStatic>

            <CardStatic>
              <CardHeader>
                <CardTitle>{t('mcp.sections.errors')}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.error_summary.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title={t('mcp.empty.errorsTitle')} description={t('mcp.empty.errorsDescription')} className="py-8" />
                ) : (
                  <div className="space-y-2">
                    {data.error_summary.map((error) => (
                      <div
                        key={`${error.server_id}:${error.error_type}`}
                        className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">{error.server_id}</div>
                          <Badge variant="red">{error.count}</Badge>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-[var(--foreground-dim)]">{error.error_type}</div>
                        <div className="mt-1 text-[11px] text-[var(--foreground-muted)]">{formatDateTime(error.last_seen_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </CardStatic>
          </div>
        </>
      )}
    </div>
  )
}

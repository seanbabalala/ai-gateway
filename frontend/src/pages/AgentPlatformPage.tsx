import { useTranslation } from 'react-i18next'
import {
  Activity,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  LockKeyhole,
  Network,
  RefreshCw,
  ShieldCheck,
  Workflow,
  Wrench,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCard } from '@/components/shared/MetricCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAgentPlatform } from '@/hooks/use-agent-platform'
import { cn, formatCost, formatLatency, formatNumber, formatTokens } from '@/lib/utils'
import type {
  AgentPlatformAgent,
  AgentPlatformResponse,
  AgentPlatformSpan,
  AgentPlatformTool,
  AgentPlatformToolServer,
  AgentPlatformWorkflow,
} from '@/types/api'

function formatDateTime(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('dashboard')
  return (
    <Badge variant={status === 'active' ? 'emerald' : 'zinc'}>
      {status === 'active' ? t('agentPlatform.status.active') : t('agentPlatform.status.disabled')}
    </Badge>
  )
}

function PermissionBadge({ permission }: { permission: AgentPlatformTool['permission'] }) {
  const { t } = useTranslation('dashboard')
  const variant = permission === 'permitted' ? 'emerald' : permission === 'blocked' ? 'red' : 'zinc'
  return <Badge variant={variant}>{t(`agentPlatform.tool.permission.${permission}`)}</Badge>
}

function PlatformContract({ data }: { data: AgentPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  const items = [
    t('agentPlatform.privacy.noPrompts'),
    t('agentPlatform.privacy.noSource'),
    t('agentPlatform.privacy.noToolPayloads'),
    t('agentPlatform.privacy.policyEnforced'),
  ]

  return (
    <CardStatic>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div>
            <CardTitle>{t('agentPlatform.privacy.title')}</CardTitle>
            <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('agentPlatform.privacy.description')}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item} className="flex min-h-[48px] items-center gap-2 rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] font-semibold text-[var(--foreground)]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="emerald">{t('agentPlatform.privacy.metadataOnly')}</Badge>
          <Badge variant="zinc">{data.version}</Badge>
          <Badge variant="amber">{t('agentPlatform.status.preview')}</Badge>
        </div>
      </CardContent>
    </CardStatic>
  )
}

function AgentsPanel({ agents }: { agents: AgentPlatformAgent[] }) {
  const { t } = useTranslation('dashboard')
  if (agents.length === 0) {
    return <EmptyState icon={Bot} title={t('agentPlatform.empty.agentsTitle')} description={t('agentPlatform.empty.agentsDescription')} />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {agents.map((agent) => (
        <CardStatic key={agent.id}>
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">{agent.name}</CardTitle>
                <StatusBadge status={agent.status} />
                <Badge variant="blue">{agent.connector}</Badge>
              </div>
              <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{agent.description || t('agentPlatform.values.noDescription')}</p>
            </div>
            <div className="text-left md:text-right">
              <div className="font-mono text-[11px] text-[var(--foreground-muted)]">{agent.smart_model_id}</div>
              <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">{agent.api_key_name || t('agentPlatform.values.noApiKey')}</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <InlineMetric label={t('agentPlatform.agent.tools')} value={`${agent.permitted_tool_count}/${agent.tool_count}`} />
              <InlineMetric label={t('agentPlatform.agent.namespace')} value={agent.namespace_name || agent.namespace_id || t('agentPlatform.values.allNamespaces')} />
              <InlineMetric label={t('agentPlatform.agent.policy')} value={agent.route_policy.allow_auto ? t('agentPlatform.values.autoAllowed') : t('agentPlatform.values.autoBlocked')} tone={agent.route_policy.allow_auto ? 'emerald' : 'amber'} />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {agent.virtual_model_aliases.map((alias) => (
                <Badge key={alias} variant="purple">{alias}</Badge>
              ))}
              {agent.mcp_server_ids.length === 0 && <Badge variant="zinc">{t('agentPlatform.values.noTools')}</Badge>}
            </div>
          </CardContent>
        </CardStatic>
      ))}
    </div>
  )
}

function ToolRegistryPanel({ servers }: { servers: AgentPlatformToolServer[] }) {
  const { t } = useTranslation('dashboard')
  if (servers.length === 0) {
    return <EmptyState icon={Wrench} title={t('agentPlatform.empty.toolsTitle')} description={t('agentPlatform.empty.toolsDescription')} />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {servers.map((server) => (
        <CardStatic key={server.id}>
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">{server.name}</CardTitle>
                <Badge variant={server.enabled ? 'emerald' : 'zinc'}>{server.enabled ? t('agentPlatform.status.enabled') : t('agentPlatform.status.disabled')}</Badge>
                <Badge variant="blue">{server.transport}</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--foreground-dim)]">{server.id}</div>
            </div>
            <div className="max-w-full truncate font-mono text-[11px] text-[var(--foreground-muted)] md:max-w-[260px]">{server.endpoint}</div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {server.allowed_namespaces.length > 0 ? (
                server.allowed_namespaces.map((namespace) => <Badge key={namespace} variant="purple">{namespace}</Badge>)
              ) : (
                <Badge variant="zinc">{t('agentPlatform.values.allNamespaces')}</Badge>
              )}
              <Badge variant="gold">{t('agentPlatform.tool.linkedProfiles', { count: server.linked_profile_ids.length })}</Badge>
            </div>
            <div className="space-y-2">
              {server.tools.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[12px] text-[var(--foreground-dim)]">{t('agentPlatform.empty.serverTools')}</div>
              ) : (
                server.tools.map((tool) => (
                  <div key={tool.name} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{tool.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {tool.has_input_schema && <Badge variant="blue">{t('agentPlatform.tool.schema')}</Badge>}
                        <PermissionBadge permission={tool.permission} />
                      </div>
                    </div>
                    {tool.description && <p className="mt-1 line-clamp-2 text-[12px] text-[var(--foreground-dim)]">{tool.description}</p>}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </CardStatic>
      ))}
    </div>
  )
}

function WorkflowPanel({ workflows }: { workflows: AgentPlatformWorkflow[] }) {
  const { t } = useTranslation('dashboard')
  if (workflows.length === 0) {
    return <EmptyState icon={Workflow} title={t('agentPlatform.empty.workflowsTitle')} description={t('agentPlatform.empty.workflowsDescription')} />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {workflows.map((workflow) => (
        <CardStatic key={workflow.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{workflow.name}</CardTitle>
              <Badge variant="amber">{t('agentPlatform.status.preview')}</Badge>
              <Badge variant="zinc">{t('agentPlatform.workflow.runtimeOff')}</Badge>
            </div>
            <p className="text-[12px] text-[var(--foreground-dim)]">{workflow.description}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workflow.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 rounded-lg bg-[var(--background-secondary)] p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] font-mono text-[11px] font-bold text-[var(--accent)]">{step.order}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[var(--foreground)]">{step.profile_name}</div>
                    <div className="font-mono text-[11px] text-[var(--foreground-dim)]">{step.connector}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CardStatic>
      ))}
    </div>
  )
}

function MemoryPanel({ data }: { data: AgentPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  const state = data.memory_gateway.metadata_state
  return (
    <CardStatic>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t('agentPlatform.memory.title')}</CardTitle>
          <Badge variant="amber">{t('agentPlatform.status.preview')}</Badge>
          <Badge variant={data.memory_gateway.content_storage_enabled ? 'amber' : 'zinc'}>
            {data.memory_gateway.content_storage_enabled ? t('agentPlatform.memory.contentOn') : t('agentPlatform.memory.contentOff')}
          </Badge>
        </div>
        <p className="text-[12px] text-[var(--foreground-dim)]">{t('agentPlatform.memory.description')}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          <InlineMetric label={t('agentPlatform.memory.sessions')} value={formatNumber(state.session_ids_observed)} />
          <InlineMetric label={t('agentPlatform.memory.turns')} value={formatNumber(state.turn_ids_observed)} />
          <InlineMetric label={t('agentPlatform.memory.repos')} value={formatNumber(state.repo_labels_observed)} />
          <InlineMetric label={t('agentPlatform.memory.projects')} value={formatNumber(state.project_labels_observed)} />
        </div>
      </CardContent>
    </CardStatic>
  )
}

function TracesTable({ spans }: { spans: AgentPlatformSpan[] }) {
  const { t } = useTranslation('dashboard')
  if (spans.length === 0) {
    return <EmptyState icon={Activity} title={t('agentPlatform.empty.tracesTitle')} description={t('agentPlatform.empty.tracesDescription')} />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('agentPlatform.traces.time')}</TableHead>
          <TableHead>{t('agentPlatform.traces.agent')}</TableHead>
          <TableHead>{t('agentPlatform.traces.session')}</TableHead>
          <TableHead>{t('agentPlatform.traces.route')}</TableHead>
          <TableHead className="text-right">{t('agentPlatform.traces.tokens')}</TableHead>
          <TableHead className="text-right">{t('agentPlatform.traces.cost')}</TableHead>
          <TableHead className="text-right">{t('agentPlatform.traces.latency')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spans.map((span) => (
          <TableRow key={span.request_id}>
            <TableCell className="whitespace-nowrap text-[12px] text-[var(--foreground-dim)]">{formatDateTime(span.timestamp)}</TableCell>
            <TableCell>
              <div className="text-[12px] font-semibold text-[var(--foreground)]">{span.profile_name || span.connector || '-'}</div>
              <div className="font-mono text-[11px] text-[var(--foreground-dim)]">{span.profile_id || span.connector || '-'}</div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] text-[var(--foreground)]">{span.session_id || '-'}</div>
              <div className="text-[11px] text-[var(--foreground-dim)]">{span.repo || span.project || '-'}</div>
            </TableCell>
            <TableCell>
              <div className="font-mono text-[12px] text-[var(--foreground)]">{span.route_decision_id}</div>
              <div className="flex flex-wrap gap-1 pt-1">
                {span.fallback && <Badge variant="amber">{t('agentPlatform.traces.fallback')}</Badge>}
                {span.retry_count > 0 && <Badge variant="blue">{t('agentPlatform.traces.retry', { count: span.retry_count })}</Badge>}
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-[12px]">{formatTokens(span.tokens.total)}</TableCell>
            <TableCell className="text-right font-mono text-[12px]">{formatCost(span.cost_usd)}</TableCell>
            <TableCell className="text-right font-mono text-[12px]">{formatLatency(span.latency_ms)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function InlineMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'emerald' | 'amber' }) {
  return (
    <div className="min-h-[72px] rounded-lg bg-[var(--background-secondary)] p-3">
      <div className="text-[10px] font-bold uppercase text-[var(--foreground-dim)]">{label}</div>
      <div
        className={cn(
          'mt-1 break-words font-mono text-[15px] font-bold text-[var(--foreground)]',
          tone === 'emerald' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'amber' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {value}
      </div>
    </div>
  )
}

export function AgentPlatformPage() {
  const { t } = useTranslation('dashboard')
  const agentPlatform = useAgentPlatform()
  const data = agentPlatform.data

  return (
    <div className="space-y-6">
      <PageHeader title={t('agentPlatform.title')} description={t('agentPlatform.description')} icon={BrainCircuit} badge={<Badge variant="amber">{t('agentPlatform.status.preview')}</Badge>}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void agentPlatform.refetch()
          }}
          disabled={agentPlatform.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', agentPlatform.isFetching && 'animate-spin')} />
          {t('agentPlatform.actions.refresh')}
        </Button>
      </PageHeader>

      {agentPlatform.isLoading && (
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

      {agentPlatform.isError && (
        <ErrorState
          error={agentPlatform.error instanceof Error ? agentPlatform.error : new Error(t('agentPlatform.error'))}
          onRetry={() => {
            void agentPlatform.refetch()
          }}
        />
      )}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={t('agentPlatform.metrics.agents')} value={formatNumber(data.totals.agents)} subtitle={t('agentPlatform.metrics.active', { count: data.totals.active_agents })} icon={Bot} />
            <MetricCard label={t('agentPlatform.metrics.tools')} value={formatNumber(data.totals.tools)} subtitle={t('agentPlatform.metrics.permitted', { count: data.totals.permitted_tools })} icon={Wrench} />
            <MetricCard label={t('agentPlatform.metrics.workflows')} value={formatNumber(data.totals.workflows)} subtitle={t('agentPlatform.metrics.previewOnly')} icon={Workflow} />
            <MetricCard label={t('agentPlatform.metrics.spans')} value={formatNumber(data.totals.recent_spans)} subtitle={t('agentPlatform.metrics.metadataOnly')} icon={GitBranch} />
          </div>

          <PlatformContract data={data} />

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-[15px] font-bold text-[var(--foreground)]">{t('agentPlatform.sections.a2aHub')}</h2>
              </div>
              <AgentsPanel agents={data.a2a_hub.agents} />
            </section>

            <div className="space-y-4">
              <CardStatic>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-4 w-4 text-[var(--accent)]" />
                    <CardTitle>{t('agentPlatform.sections.policy')}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <PolicyRow label={t('agentPlatform.policy.workspace')} ok />
                    <PolicyRow label={t('agentPlatform.policy.gatewayKey')} ok />
                    <PolicyRow label={t('agentPlatform.policy.mcp')} ok />
                    <PolicyRow label={t('agentPlatform.policy.noBypass')} ok />
                  </div>
                </CardContent>
              </CardStatic>
              <MemoryPanel data={data} />
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-[15px] font-bold text-[var(--foreground)]">{t('agentPlatform.sections.tools')}</h2>
            </div>
            <ToolRegistryPanel servers={data.tool_registry.servers} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-[15px] font-bold text-[var(--foreground)]">{t('agentPlatform.sections.workflow')}</h2>
            </div>
            <WorkflowPanel workflows={data.workflow_preview.workflows} />
          </section>

          <CardStatic>
            <CardHeader>
              <CardTitle>{t('agentPlatform.sections.traces')}</CardTitle>
              <p className="text-[12px] text-[var(--foreground-dim)]">{t('agentPlatform.traces.description')}</p>
            </CardHeader>
            <CardContent>
              <TracesTable spans={data.traces.spans} />
            </CardContent>
          </CardStatic>
        </>
      )}
    </div>
  )
}

function PolicyRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] font-semibold text-[var(--foreground)]">
      <CheckCircle2 className={cn('h-4 w-4 shrink-0', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')} />
      <span>{label}</span>
    </div>
  )
}

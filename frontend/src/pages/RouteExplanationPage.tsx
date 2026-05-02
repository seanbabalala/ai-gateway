import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Filter,
  GitFork,
  Info,
  Route,
  ShieldCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Tooltip } from '@/components/ui/tooltip'
import { useRouteDecision, useRouteDecisions } from '@/hooks/use-route-decisions'
import { cn, formatCost, formatLatency, formatTimestamp } from '@/lib/utils'
import type {
  RouteDecisionCandidate,
  RouteDecisionFilter,
  RouteDecisionSummary,
  RouteDecisionTarget,
  RouteDecisionTrace,
} from '@/types/api'

const LIMIT = 15

const tierOptions = [
  { value: '', label: 'All tiers' },
  { value: 'simple', label: 'Simple' },
  { value: 'standard', label: 'Standard' },
  { value: 'complex', label: 'Complex' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'direct', label: 'Direct' },
]

const sourceOptions = [
  { value: '', label: 'All sources' },
  { value: 'chat_completions', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
  { value: 'messages', label: 'Messages' },
  { value: 'embeddings', label: 'Embeddings' },
]

function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return value.toFixed(3)
}

function formatTarget(target?: RouteDecisionTarget | null) {
  if (!target?.node && !target?.model) return 'none'
  return `${target.node || 'unknown'} / ${target.model || 'unknown'}`
}

function formatReason(reason?: string | null) {
  return reason ? reason.replaceAll('_', ' ') : 'none'
}

function contextBadge(fit: RouteDecisionCandidate['metrics']['context_fit']) {
  if (fit === 'safe') return 'emerald'
  if (fit === 'near_limit') return 'amber'
  if (fit === 'overflow') return 'red'
  return 'zinc'
}

function circuitBadge(state: string, available: boolean) {
  if (!available || state === 'OPEN') return 'red'
  if (state === 'HALF_OPEN') return 'amber'
  return 'emerald'
}

function ScoreMeter({
  label,
  value,
}: {
  label: string
  value: number | null
}) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value * 100))
  return (
    <div className="min-w-[92px]">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
        <span>{label}</span>
        <span className="font-mono">{value === null ? '-' : value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
        <div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string | null
}) {
  return (
    <CardStatic>
      <CardContent className="pt-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
          {label}
        </div>
        <div className="mt-2 truncate font-mono text-[18px] font-bold text-[var(--foreground)]">
          {value}
        </div>
        {detail && (
          <div className="mt-1 truncate text-[11px] font-medium text-[var(--foreground-dim)]">
            {detail}
          </div>
        )}
      </CardContent>
    </CardStatic>
  )
}

function PrivacyBadge({ trace }: { trace: RouteDecisionTrace }) {
  const safe =
    trace.privacy.prompt === false &&
    trace.privacy.response === false &&
    trace.privacy.raw_headers === false &&
    trace.privacy.provider_keys === false

  return (
    <Badge variant={safe ? 'emerald' : 'amber'} className="gap-1.5">
      <ShieldCheck className="h-3 w-3" />
      {safe ? 'Metadata only' : 'Review privacy flags'}
    </Badge>
  )
}

function CandidateTable({ candidates }: { candidates: RouteDecisionCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={GitFork}
        title="No candidates recorded"
        description="The request was logged before route trace details were available."
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          <TableHead>Circuit</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead>Tradeoff scores</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Latency</TableHead>
          <TableHead>Context</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((candidate) => (
          <TableRow key={`${candidate.node}:${candidate.model}:${candidate.position}`}>
            <TableCell>
              <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                {candidate.node}
              </div>
              <div className="mt-0.5 max-w-[220px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                <Tooltip content={candidate.model}>
                  <span>{candidate.model}</span>
                </Tooltip>
              </div>
              {candidate.weight !== null && (
                <div className="mt-1 text-[10px] font-medium text-[var(--foreground-dim)]">
                  weight {candidate.weight}
                </div>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={circuitBadge(candidate.circuit_state, candidate.circuit_available)}>
                {candidate.circuit_state}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                {candidate.selected && <Badge variant="emerald">selected</Badge>}
                {candidate.fallback && <Badge variant="blue">fallback</Badge>}
                {!candidate.selected && !candidate.fallback && (
                  <Badge variant="zinc">filtered</Badge>
                )}
              </div>
              {candidate.filter_reasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {candidate.filter_reasons.map((reason) => (
                    <Badge key={reason} variant="amber">
                      {formatReason(reason)}
                    </Badge>
                  ))}
                </div>
              )}
            </TableCell>
            <TableCell>
              <div className="grid gap-2 sm:grid-cols-3">
                <ScoreMeter label="cost" value={candidate.scores.cost} />
                <ScoreMeter label="latency" value={candidate.scores.latency} />
                <ScoreMeter label="context" value={candidate.scores.context} />
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
              {candidate.metrics.estimated_cost_usd === null
                ? '-'
                : formatCost(candidate.metrics.estimated_cost_usd)}
            </TableCell>
            <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
              {candidate.metrics.avg_latency_ms === null
                ? '-'
                : formatLatency(candidate.metrics.avg_latency_ms)}
              {candidate.metrics.p95_latency_ms !== null && (
                <div className="text-[10px] text-[var(--foreground-dim)]">
                  p95 {formatLatency(candidate.metrics.p95_latency_ms)}
                </div>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={contextBadge(candidate.metrics.context_fit)}>
                {candidate.metrics.context_fit.replaceAll('_', ' ')}
              </Badge>
              {candidate.metrics.max_context_tokens !== null && (
                <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">
                  max {candidate.metrics.max_context_tokens.toLocaleString()}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function FilterList({ filters }: { filters: RouteDecisionFilter[] }) {
  if (filters.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--inset-bg)] px-4 py-3 text-[12px] font-medium text-[var(--foreground-dim)]">
        No target was removed by routing constraints.
      </div>
    )
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {filters.map((filter, index) => (
        <div
          key={`${filter.node}:${filter.model}:${filter.stage}:${index}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate font-mono text-[11px] font-semibold text-[var(--foreground)]">
              {filter.node} / {filter.model}
            </div>
            <Badge variant="zinc">{filter.stage}</Badge>
          </div>
          <div className="mt-1 text-[12px] text-[var(--foreground-muted)]">
            {filter.reason}
          </div>
        </div>
      ))}
    </div>
  )
}

function RouteDecisionDetail({ requestId }: { requestId: string }) {
  const { data, isLoading, isError, error, refetch } = useRouteDecision(requestId)

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Route Explanation" description={requestId} icon={Route} />
        <SkeletonTable rows={6} cols={5} />
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={Route}
        title="Route decision not found"
        description="The request id has no route decision row."
      />
    )
  }

  const trace = data.trace

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Explanation"
        description={data.request_id}
        icon={Route}
        badge={<Badge variant="gold">Read only</Badge>}
      >
        <Link to="/route-decisions">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" />
            All decisions
          </Button>
        </Link>
      </PageHeader>

      {!trace ? (
        <CardStatic>
          <CardContent className="pt-5">
            <EmptyState
              icon={Info}
              title="No trace body available"
              description="This row has summary metadata but no detailed trace JSON."
            />
          </CardContent>
        </CardStatic>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label="Final selection"
              value={formatTarget({
                node: trace.final_selection.node || data.selected.node,
                model: trace.final_selection.model || data.selected.model,
              })}
              detail={trace.final_selection.reason}
            />
            <SummaryTile
              label="Strategy"
              value={trace.load_balancing.strategy}
              detail={`${trace.load_balancing.source} source`}
            />
            <SummaryTile
              label="Score"
              value={formatScore(trace.score)}
              detail={`${trace.tier} tier`}
            />
            <SummaryTile
              label="Outcome"
              value={String(trace.outcome?.status_code ?? data.status_code)}
              detail={trace.outcome?.error || data.fallback_reason}
            />
          </div>

          <CardStatic>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Decision Path</CardTitle>
                <div className="mt-1 text-[12px] text-[var(--foreground-dim)]">
                  {trace.load_balancing.reason || data.summary.reason || 'No route reason recorded.'}
                </div>
              </div>
              <PrivacyBadge trace={trace} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                    Source
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[var(--foreground)]">
                    {trace.source_format || data.source_format}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                    Domain hints
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[var(--foreground)]">
                    {trace.domain_hints.domain || 'none'}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                    {trace.domain_hints.modalities.join(', ') || 'no modalities'}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--inset-bg)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground-dim)]">
                    Constraints
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[var(--foreground)]">
                    context {trace.constraints.estimated_context_tokens?.toLocaleString() || 'unknown'}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">
                    structured output {trace.constraints.requires_structured_output ? 'required' : 'not required'}
                  </div>
                </div>
              </div>
            </CardContent>
          </CardStatic>

          <CardStatic>
            <CardHeader>
              <CardTitle>Candidate Models</CardTitle>
            </CardHeader>
            <CardContent>
              <CandidateTable candidates={trace.candidate_targets} />
            </CardContent>
          </CardStatic>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <CardStatic>
              <CardHeader className="flex-row items-center gap-2">
                <Filter className="h-4 w-4 text-[var(--accent)]" />
                <CardTitle>Filtered Targets</CardTitle>
              </CardHeader>
              <CardContent>
                <FilterList filters={trace.filters} />
              </CardContent>
            </CardStatic>

            <CardStatic>
              <CardHeader>
                <CardTitle>Fallback Chain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={trace.final_selection.is_fallback ? 'amber' : 'emerald'}>
                    {trace.final_selection.is_fallback ? 'fallback used' : 'primary selected'}
                  </Badge>
                  {trace.final_selection.fallback_reason && (
                    <Badge variant="amber">
                      {formatReason(trace.final_selection.fallback_reason)}
                    </Badge>
                  )}
                </div>

                {trace.cost_downgrade?.applied && (
                  <div className="rounded-lg border border-amber-500/15 bg-amber-500/8 px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      Cost downgrade
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatTarget(trace.cost_downgrade.from)} to {formatTarget(trace.cost_downgrade.to)}
                    </div>
                  </div>
                )}

                {trace.fallback_chain.length === 0 ? (
                  <div className="rounded-lg bg-[var(--inset-bg)] px-3 py-2.5 text-[12px] text-[var(--foreground-dim)]">
                    No fallback target was kept after routing constraints.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {trace.fallback_chain.map((target) => (
                      <div
                        key={`${target.node}:${target.model}`}
                        className="rounded-lg bg-[var(--inset-bg)] px-3 py-2.5 font-mono text-[11px] text-[var(--foreground-muted)]"
                      >
                        {formatTarget(target)}
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

function RouteDecisionList() {
  const [page, setPage] = useState(1)
  const [tierFilter, setTierFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const { data, isLoading, isError, error, refetch } = useRouteDecisions(page, LIMIT, {
    tier: tierFilter || undefined,
    source_format: sourceFilter || undefined,
    node: nodeFilter || undefined,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Explanation"
        description="Read-only routing decisions"
        icon={Route}
        badge={<Badge variant="gold">Read only</Badge>}
      />

      <CardStatic className="animate-fade-up p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            options={tierOptions}
            value={tierFilter}
            onChange={(value) => {
              setTierFilter(value)
              setPage(1)
            }}
            className="w-36"
          />
          <Select
            options={sourceOptions}
            value={sourceFilter}
            onChange={(value) => {
              setSourceFilter(value)
              setPage(1)
            }}
            className="w-44"
          />
          <Input
            placeholder="Filter by selected node..."
            value={nodeFilter}
            onChange={(event) => {
              setNodeFilter(event.target.value)
              setPage(1)
            }}
            className="w-56"
          />
          <div className="ml-auto font-mono text-[11px] text-[var(--foreground-dim)]">
            {data?.pagination ? `${data.pagination.total} decisions` : '...'}
          </div>
        </div>
      </CardStatic>

      <CardStatic className="animate-fade-up" style={{ animationDelay: '80ms' }}>
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <SkeletonTable rows={8} cols={8} />
        ) : !data?.data.length ? (
          <EmptyState
            icon={Route}
            title="No route decisions"
            description="Route decision rows appear after requests complete."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Selected</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Fallback</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((decision: RouteDecisionSummary) => (
                  <TableRow key={decision.id}>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {formatTimestamp(decision.timestamp)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {decision.source_format}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={decision.tier} />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">
                        {decision.selected.node}
                      </div>
                      <div className="max-w-[220px] truncate font-mono text-[11px] text-[var(--foreground-dim)]">
                        <Tooltip content={decision.selected.model}>
                          <span>{decision.selected.model}</span>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="blue">{decision.candidate_count} candidates</Badge>
                        <Badge variant={decision.filtered_count > 0 ? 'amber' : 'zinc'}>
                          {decision.filtered_count} filtered
                        </Badge>
                      </div>
                      {decision.summary.reason && (
                        <div className="mt-1 max-w-[300px] truncate text-[11px] text-[var(--foreground-dim)]">
                          {decision.summary.reason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={decision.is_fallback ? 'amber' : 'emerald'}>
                        {decision.is_fallback ? 'yes' : 'no'}
                      </Badge>
                      {decision.fallback_reason && (
                        <div className="mt-1 text-[10px] text-[var(--foreground-dim)]">
                          {formatReason(decision.fallback_reason)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-mono text-[11px] font-semibold',
                          decision.status_code < 400
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {decision.status_code}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link to={`/route-decisions/${encodeURIComponent(decision.request_id)}`}>
                        <Button variant="ghost" size="sm">
                          Explain
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
                <div className="font-mono text-[11px] text-[var(--foreground-dim)]">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= data.pagination.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardStatic>

      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] px-4 py-3 text-[12px] text-[var(--foreground-dim)]">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        Route explanations are read-only and never expose prompts, responses, raw headers, or provider keys.
      </div>
    </div>
  )
}

export function RouteExplanationPage() {
  const { requestId } = useParams<{ requestId?: string }>()

  if (requestId) {
    return <RouteDecisionDetail requestId={requestId} />
  }

  return <RouteDecisionList />
}

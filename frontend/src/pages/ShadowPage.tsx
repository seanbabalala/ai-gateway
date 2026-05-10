import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  DollarSign,
  Filter,
  GitCompareArrows,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { DocsLinkGroup, repoDocsUrl } from '@/components/shared/DocsLinkGroup'
import { SetupGuidePanel } from '@/components/shared/SetupGuidePanel'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useNamespaces } from '@/hooks/use-namespaces'
import { useShadowReport, useShadowTraffic } from '@/hooks/use-shadow'
import { formatCost, formatLatency, formatPercent, formatTimestamp, formatTokens } from '@/lib/utils'
import type { ShadowComparisonReport, ShadowReportFilters } from '@/types/api'

const PERIOD_OPTIONS = ['24h', '7d', '30d']
const SOURCE_FORMAT_OPTIONS = [
  '',
  'chat_completions',
  'responses',
  'messages',
  'embeddings',
  'rerank',
  'image_generation',
  'image_edit',
  'image_variation',
  'audio_transcription',
  'audio_translation',
  'audio_speech',
  'video_generation',
]

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return formatPercent(value * 100)
}

function formatSignedLatency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${value > 0 ? '+' : ''}${formatLatency(value)}`
}

function formatSignedCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatCost(Math.abs(value))}`
}

function formatSignedTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${value > 0 ? '+' : ''}${formatTokens(value)}`
}

function confidenceVariant(level?: string): BadgeProps['variant'] {
  if (level === 'high') return 'emerald'
  if (level === 'medium') return 'blue'
  return 'amber'
}

function deltaVariant(value: number | null | undefined, positiveIsGood = false): BadgeProps['variant'] {
  if (value === null || value === undefined || Math.abs(value) < 0.000001) return 'zinc'
  const good = positiveIsGood ? value > 0 : value < 0
  return good ? 'emerald' : 'amber'
}

const SHADOW_SETUP_SNIPPET = `shadow:
  enabled: true
  sample_rate: 0.05
  target_node: openai-staging
  target_model: gpt-4o-mini
  timeout_ms: 30000
  max_recent_results: 100
  compare:
    store_prompts: false
    store_responses: false
    sample_max_chars: 4000`

export function ShadowPage() {
  const { t } = useTranslation('dashboard')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('7d')
  const [sourceFormatFilter, setSourceFormatFilter] = useState('')
  const { data: namespacesData } = useNamespaces()
  const reportFilters = useMemo<ShadowReportFilters>(
    () => ({
      namespace: namespaceFilter || undefined,
      api_key: apiKeyFilter || undefined,
      node: nodeFilter || undefined,
      model: modelFilter || undefined,
      period: periodFilter,
      source_format: sourceFormatFilter || undefined,
    }),
    [apiKeyFilter, modelFilter, namespaceFilter, nodeFilter, periodFilter, sourceFormatFilter],
  )
  const shadowQuery = useShadowTraffic(namespaceFilter || undefined)
  const reportQuery = useShadowReport(reportFilters)
  const namespaceOptions = [
    { value: '', label: t('filters.allNamespaces') },
    ...(namespacesData?.namespaces || []).map((namespace) => ({
      value: namespace.id,
      label: namespace.name || namespace.id,
    })),
  ]

  if (shadowQuery.isError) {
    return <ErrorState error={shadowQuery.error} onRetry={shadowQuery.refetch} />
  }
  if (reportQuery.isError) {
    return <ErrorState error={reportQuery.error} onRetry={reportQuery.refetch} />
  }

  const status = shadowQuery.data?.status
  const recent = shadowQuery.data?.recent || []
  const report = reportQuery.data
  const storageWarning = Boolean(status?.privacy.stores_prompts || status?.privacy.stores_responses)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('shadow.title')}
        description={t('shadow.description')}
        icon={GitCompareArrows}
      >
        <Badge variant="zinc">{t('shadow.readOnly')}</Badge>
      </PageHeader>

      <ConceptPanel
        conceptId="shadowTraffic"
        icon={GitCompareArrows}
        badgeKinds={['readOnly', 'configDriven', 'requiresConfig']}
      />

      <DocsLinkGroup
        links={[
          { label: t('shadow.docs.namespaceShadow'), href: repoDocsUrl('docs/NAMESPACES_AND_SHADOW.md#shadow-traffic') },
          { label: t('shadow.docs.api'), href: repoDocsUrl('docs/API_REFERENCE.md#shadow-traffic') },
          { label: t('shadow.docs.evals'), href: repoDocsUrl('docs/EVALUATION_FRAMEWORK.md') },
          { label: t('shadow.docs.experiments'), href: repoDocsUrl('docs/API_REFERENCE.md#traffic-experiments') },
        ]}
      />

      {status && (
        <SetupGuidePanel
          title={t('shadow.setup.title')}
          description={t('shadow.setup.description')}
          icon={GitCompareArrows}
          statuses={[
            {
              label: t('shadow.setup.status.shadow'),
              value: status.enabled ? t('shadow.enabled') : t('shadow.disabled'),
              tone: status.enabled ? 'emerald' : 'zinc',
            },
            {
              label: t('shadow.setup.status.target'),
              value: status.target_node && status.target_model ? t('shadow.setup.status.configured') : t('shadow.setup.status.missing'),
              tone: status.target_node && status.target_model ? 'emerald' : 'amber',
            },
            {
              label: t('shadow.setup.status.samples'),
              value: status.compare.store_prompts || status.compare.store_responses
                ? t('shadow.setup.status.explicitStorage')
                : t('shadow.setup.status.notStored'),
              tone: status.compare.store_prompts || status.compare.store_responses ? 'amber' : 'emerald',
            },
          ]}
          bullets={[
            t('shadow.setup.bullets.asyncMirror'),
            t('shadow.setup.bullets.notExperiment'),
            t('shadow.setup.bullets.notEval'),
            t('shadow.setup.bullets.noPromotion'),
          ]}
          snippetTitle={t('shadow.setup.snippetTitle')}
          snippet={SHADOW_SETUP_SNIPPET}
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.status')}
            </div>
            <div className="mt-2">
              <Badge variant={status?.enabled ? 'emerald' : 'zinc'}>
                {status?.enabled ? t('shadow.enabled') : t('shadow.disabled')}
              </Badge>
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.sampleRate')}
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--foreground)]">
              {Math.round((status?.sample_rate || 0) * 100)}%
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('shadow.target')}
            </div>
            <div className="mt-2 truncate font-mono text-[13px] font-semibold text-[var(--foreground)]">
              {status?.target_node || t('shadow.none')}
              {status?.target_model ? ` / ${status.target_model}` : ''}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('shadow.storage')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={status?.privacy.stores_prompts ? 'amber' : 'emerald'}>
                {t('shadow.promptsStorage', {
                  state: status?.privacy.stores_prompts ? t('shadow.on') : t('shadow.off'),
                })}
              </Badge>
              <Badge variant={status?.privacy.stores_responses ? 'amber' : 'emerald'}>
                {t('shadow.responsesStorage', {
                  state: status?.privacy.stores_responses ? t('shadow.on') : t('shadow.off'),
                })}
              </Badge>
            </div>
          </CardContent>
        </CardStatic>
      </div>

      {storageWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <div className="font-semibold">{t('shadow.privacyWarningTitle')}</div>
            <div className="mt-1 text-[var(--foreground-muted)]">{t('shadow.privacyWarningDescription')}</div>
          </div>
        </div>
      )}

      <CardStatic>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--foreground-dim)]" />
            {t('shadow.filters.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Select
              options={namespaceOptions}
              value={namespaceFilter}
              onChange={(value) => setNamespaceFilter(value)}
            />
            <Input
              value={apiKeyFilter}
              onChange={(event) => setApiKeyFilter(event.target.value)}
              placeholder={t('shadow.filters.apiKey')}
            />
            <Input
              value={nodeFilter}
              onChange={(event) => setNodeFilter(event.target.value)}
              placeholder={t('shadow.filters.node')}
            />
            <Input
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              placeholder={t('shadow.filters.model')}
            />
            <Select
              options={PERIOD_OPTIONS.map((period) => ({
                value: period,
                label: t(`shadow.period.${period}`),
              }))}
              value={periodFilter}
              onChange={(value) => setPeriodFilter(value)}
            />
            <Select
              options={SOURCE_FORMAT_OPTIONS.map((source) => ({
                value: source,
                label: source ? t(`shadow.sourceFormat.${source}`, { defaultValue: source }) : t('shadow.filters.allFormats'),
              }))}
              value={sourceFormatFilter}
              onChange={(value) => setSourceFormatFilter(value)}
            />
          </div>
        </CardContent>
      </CardStatic>

      <ShadowReportCard report={report} isLoading={reportQuery.isLoading} />

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('shadow.recentResults')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shadowQuery.isLoading ? (
            <SkeletonTable rows={8} cols={8} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={GitCompareArrows}
              title={t('shadow.emptyTitle')}
              description={t('shadow.emptyDescription')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('shadow.table.time')}</TableHead>
                  <TableHead>{t('shadow.table.status')}</TableHead>
                  <TableHead>{t('shadow.table.namespace')}</TableHead>
                  <TableHead>{t('shadow.table.kind')}</TableHead>
                  <TableHead>{t('shadow.table.primary')}</TableHead>
                  <TableHead>{t('shadow.table.shadow')}</TableHead>
                  <TableHead className="text-right">{t('shadow.table.tokens')}</TableHead>
                  <TableHead className="text-right">{t('shadow.table.latency')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {formatTimestamp(item.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === 'sent'
                            ? 'emerald'
                            : item.status === 'failed'
                              ? 'red'
                              : 'zinc'
                        }
                      >
                        {t(`shadow.resultStatus.${item.status}`, { defaultValue: item.status })}
                      </Badge>
                      {item.error && (
                        <div className="mt-1 max-w-[260px] truncate text-[10px] text-red-500">
                          {item.error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.namespace_id
                        ? t('shadow.policyNamespaceValue', { namespace: item.namespace_id })
                        : t('shadow.allNamespacesShort')}
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {t(`shadow.kind.${item.kind}`, { defaultValue: item.kind })}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.primary_node} / {item.primary_model}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.shadow_node} / {item.shadow_model}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">
                      {formatTokens(item.input_tokens + item.output_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">
                      {item.latency_ms === null ? '-' : formatLatency(item.latency_ms)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

function ShadowReportCard({
  report,
  isLoading,
}: {
  report?: ShadowComparisonReport
  isLoading: boolean
}) {
  const { t } = useTranslation('dashboard')

  return (
    <CardStatic>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('shadow.report.title')}</CardTitle>
          {report && (
            <Badge variant={confidenceVariant(report.confidence.level)}>
              {t(`shadow.confidence.${report.confidence.level}`)} · {formatRate(report.confidence.score)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading || !report ? (
          <SkeletonTable rows={5} cols={4} />
        ) : report.window.rows === 0 ? (
          <EmptyState
            icon={GitCompareArrows}
            title={t('shadow.report.emptyTitle')}
            description={t('shadow.report.emptyDescription')}
          />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricTile
                icon={Activity}
                label={t('shadow.report.samples')}
                value={String(report.window.comparable)}
                detail={t('shadow.report.samplesDetail', {
                  total: report.window.rows,
                  missing: report.window.missing_primary_logs,
                })}
              />
              <MetricTile
                icon={Gauge}
                label={t('shadow.report.success')}
                value={formatRate(report.shadow_success_rate)}
                detail={t('shadow.report.primaryValue', {
                  value: formatRate(report.primary_success_rate),
                })}
              />
              <MetricTile
                icon={GitCompareArrows}
                label={t('shadow.report.latencyDelta')}
                value={formatSignedLatency(report.latency_delta_ms)}
                badge={t('shadow.report.p95Delta', {
                  value: formatSignedLatency(report.p95_latency_comparison.delta_ms),
                })}
                badgeVariant={deltaVariant(report.latency_delta_ms)}
              />
              <MetricTile
                icon={DollarSign}
                label={t('shadow.report.potentialSavings')}
                value={formatCost(report.potential_savings_usd)}
                badge={formatSignedCost(report.cost_delta_usd)}
                badgeVariant={deltaVariant(report.cost_delta_usd)}
              />
              <MetricTile
                icon={Sparkles}
                label={t('shadow.report.qualityCoverage')}
                value={formatRate(report.quality_sample_coverage)}
                detail={t('shadow.report.samplesPrivacy')}
              />
            </div>

            {report.risk_notes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {report.risk_notes.map((risk) => (
                  <Badge key={risk} variant={risk.includes('lower') || risk.includes('regression') || risk.includes('higher') ? 'amber' : 'zinc'}>
                    {t(`shadow.risk.${risk}`, { defaultValue: risk })}
                  </Badge>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('shadow.report.table.route')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.calls')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.success')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.p50')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.p95')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.costDelta')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.tokenDelta')}</TableHead>
                    <TableHead className="text-right">{t('shadow.report.table.fallbackDelta')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.pairs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-[12px] text-[var(--foreground-muted)]">
                        {t('shadow.report.noPairs')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.pairs.map((pair) => (
                      <TableRow key={`${pair.primary_node}:${pair.primary_model}:${pair.shadow_node}:${pair.shadow_model}`}>
                        <TableCell>
                          <div className="font-mono text-[11px] text-[var(--foreground)]">
                            {pair.primary_node} / {pair.primary_model}
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-[var(--foreground-muted)]">
                            {pair.shadow_node} / {pair.shadow_model}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">{pair.calls}</TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatRate(pair.primary_success_rate)} → {formatRate(pair.shadow_success_rate)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {pair.primary_p50_latency_ms === null ? '-' : formatLatency(pair.primary_p50_latency_ms)}
                          {' → '}
                          {pair.shadow_p50_latency_ms === null ? '-' : formatLatency(pair.shadow_p50_latency_ms)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {pair.primary_p95_latency_ms === null ? '-' : formatLatency(pair.primary_p95_latency_ms)}
                          {' → '}
                          {pair.shadow_p95_latency_ms === null ? '-' : formatLatency(pair.shadow_p95_latency_ms)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={deltaVariant(pair.cost_delta_usd)}>
                            {formatSignedCost(pair.cost_delta_usd)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatSignedTokens(pair.token_delta)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatRate(pair.fallback_delta)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </CardStatic>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  badge,
  badgeVariant = 'zinc',
}: {
  icon: typeof Activity
  label: string
  value: string
  detail?: string
  badge?: string
  badgeVariant?: BadgeProps['variant']
}) {
  return (
    <div className="rounded-lg bg-[var(--background-tertiary)] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xl font-bold text-[var(--foreground)]">{value}</span>
        {badge && <Badge variant={badgeVariant}>{badge}</Badge>}
      </div>
      {detail && <div className="mt-1 text-[11px] text-[var(--foreground-dim)]">{detail}</div>}
    </div>
  )
}

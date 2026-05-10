import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BrainCircuit,
  CheckCircle2,
  DatabaseZap,
  FileCode2,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { MetricCard } from '@/components/shared/MetricCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  useCreateSemanticPromptTemplate,
  useInvalidateSemanticCache,
  useSemanticPlatform,
} from '@/hooks/use-semantic-platform'
import { cn, formatNumber, formatPercent } from '@/lib/utils'
import type {
  SemanticPlatformPromptTemplate,
  SemanticPlatformResponse,
} from '@/types/api'

function percent(value: number): string {
  return formatPercent(value * 100)
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function PrivacyContract({ data }: { data: SemanticPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  const items = [
    t('semanticPlatform.privacy.noContent'),
    t('semanticPlatform.privacy.noHeaders'),
    t('semanticPlatform.privacy.noSecrets'),
    t('semanticPlatform.privacy.optIn'),
  ]

  return (
    <CardStatic>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <CardTitle>{t('semanticPlatform.privacy.title')}</CardTitle>
            <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.privacy.description')}</p>
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
          <Badge variant="emerald">{t('semanticPlatform.privacy.metadataOnly')}</Badge>
          <Badge variant={data.privacy.semantic_cache_response_storage_opt_in ? 'amber' : 'zinc'}>
            {data.privacy.semantic_cache_response_storage_opt_in
              ? t('semanticPlatform.privacy.responseOptIn')
              : t('semanticPlatform.privacy.responseStorageOff')}
          </Badge>
          <Badge variant={data.privacy.prompt_registry_content_storage_opt_in ? 'amber' : 'zinc'}>
            {data.privacy.prompt_registry_content_storage_opt_in
              ? t('semanticPlatform.privacy.templateOptIn')
              : t('semanticPlatform.privacy.templateHashOnly')}
          </Badge>
          <Badge variant="zinc">{data.version}</Badge>
        </div>
      </CardContent>
    </CardStatic>
  )
}

function SemanticCachePanel({
  data,
  onInvalidate,
  invalidating,
}: {
  data: SemanticPlatformResponse
  onInvalidate: () => void
  invalidating: boolean
}) {
  const { t } = useTranslation('dashboard')
  const cache = data.semantic_cache
  const totalLookups = cache.hits + cache.misses
  const hitRate = totalLookups === 0 ? 0 : cache.hits / totalLookups

  return (
    <CardStatic>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>{t('semanticPlatform.sections.semanticCache')}</CardTitle>
          <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.semanticCacheDescription')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={cache.enabled ? 'emerald' : 'zinc'}>
            {cache.enabled ? t('semanticPlatform.status.enabled') : t('semanticPlatform.status.disabled')}
          </Badge>
          <Badge variant={cache.explicit_response_storage_opt_in ? 'amber' : 'zinc'}>
            {cache.explicit_response_storage_opt_in
              ? t('semanticPlatform.cache.responseOptIn')
              : t('semanticPlatform.cache.metadataOnly')}
          </Badge>
          <Button variant="secondary" size="sm" onClick={onInvalidate} disabled={invalidating}>
            <RefreshCw className={cn('h-3.5 w-3.5', invalidating && 'animate-spin')} />
            {t('semanticPlatform.actions.invalidateWorkspace')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          <InlineMetric label={t('semanticPlatform.cache.backend')} value={cache.backend} />
          <InlineMetric label={t('semanticPlatform.cache.isolation')} value={cache.isolation} />
          <InlineMetric label={t('semanticPlatform.cache.hitRate')} value={percent(hitRate)} tone={hitRate > 0 ? 'emerald' : 'default'} />
          <InlineMetric label={t('semanticPlatform.cache.threshold')} value={cache.threshold.toFixed(2)} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <InlineMetric label={t('semanticPlatform.cache.matches')} value={formatNumber(cache.matches)} />
          <InlineMetric label={t('semanticPlatform.cache.hits')} value={formatNumber(cache.hits)} />
          <InlineMetric label={t('semanticPlatform.cache.metadataMatches')} value={formatNumber(cache.recent_metadata_matches)} />
          <InlineMetric label={t('semanticPlatform.cache.invalidations')} value={formatNumber(cache.invalidations)} />
        </div>
      </CardContent>
    </CardStatic>
  )
}

function PromptRegistryPanel({ templates }: { templates: SemanticPlatformPromptTemplate[] }) {
  const { t } = useTranslation('dashboard')
  if (templates.length === 0) {
    return <EmptyState icon={FileCode2} title={t('semanticPlatform.empty.templatesTitle')} description={t('semanticPlatform.empty.templatesDescription')} />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('semanticPlatform.table.prompt')}</TableHead>
          <TableHead>{t('semanticPlatform.table.version')}</TableHead>
          <TableHead>{t('semanticPlatform.table.variables')}</TableHead>
          <TableHead>{t('semanticPlatform.table.routePolicy')}</TableHead>
          <TableHead>{t('semanticPlatform.table.storage')}</TableHead>
          <TableHead>{t('semanticPlatform.table.updated')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell>
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{template.prompt_key}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--foreground-muted)]">{template.template_hash}</div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={template.status === 'active' ? 'emerald' : 'zinc'}>v{template.version}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex max-w-[260px] flex-wrap gap-1">
                {template.variables.length > 0 ? template.variables.map((variable) => (
                  <Badge key={variable} variant="blue">{variable}</Badge>
                )) : <Badge variant="zinc">{t('semanticPlatform.values.none')}</Badge>}
              </div>
            </TableCell>
            <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
              {template.route_policy_id || t('semanticPlatform.values.none')}
            </TableCell>
            <TableCell>
              <Badge variant={template.content_storage_enabled ? 'amber' : 'emerald'}>
                {template.content_storage_enabled
                  ? t('semanticPlatform.template.contentStored')
                  : t('semanticPlatform.template.hashOnly')}
              </Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-[12px] text-[var(--foreground-dim)]">{formatDateTime(template.updated_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PromptTemplateForm() {
  const { t } = useTranslation('dashboard')
  const createTemplate = useCreateSemanticPromptTemplate()
  const [promptKey, setPromptKey] = useState('')
  const [name, setName] = useState('')
  const [variables, setVariables] = useState('')
  const [routePolicy, setRoutePolicy] = useState('')
  const [template, setTemplate] = useState('')

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!promptKey.trim() || !template.trim()) return
    createTemplate.mutate({
      prompt_key: promptKey.trim(),
      name: name.trim() || null,
      template,
      variables: variables.split(',').map((item) => item.trim()).filter(Boolean),
      route_policy_id: routePolicy.trim() || null,
    }, {
      onSuccess: () => {
        setPromptKey('')
        setName('')
        setVariables('')
        setRoutePolicy('')
        setTemplate('')
      },
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Input value={promptKey} onChange={(event) => setPromptKey(event.target.value)} placeholder={t('semanticPlatform.form.promptKey')} />
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('semanticPlatform.form.name')} />
        <Input value={variables} onChange={(event) => setVariables(event.target.value)} placeholder={t('semanticPlatform.form.variables')} />
        <Input value={routePolicy} onChange={(event) => setRoutePolicy(event.target.value)} placeholder={t('semanticPlatform.form.routePolicy')} />
      </div>
      <textarea
        value={template}
        onChange={(event) => setTemplate(event.target.value)}
        placeholder={t('semanticPlatform.form.template')}
        className="min-h-[104px] w-full resize-y rounded-lg bg-[var(--background-secondary)] px-3.5 py-2 text-[13px] text-[var(--foreground)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200 placeholder:text-[var(--foreground-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]"
      />
      {createTemplate.isError && (
        <div className="rounded-lg border border-red-500/15 bg-red-500/8 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
          {createTemplate.error.message}
        </div>
      )}
      {createTemplate.isSuccess && (
        <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/8 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-400">
          {t('semanticPlatform.form.created')}
        </div>
      )}
      <Button type="submit" size="sm" disabled={createTemplate.isPending || !promptKey.trim() || !template.trim()}>
        <FileCode2 className="h-3.5 w-3.5" />
        {createTemplate.isPending ? t('semanticPlatform.actions.creating') : t('semanticPlatform.actions.createTemplate')}
      </Button>
    </form>
  )
}

function ContextIntentPanel({ data }: { data: SemanticPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  const contextActions = data.context_optimizer.actions
  const intentRows = data.intent_classification.categories.map((category) => ({
    category,
    count: data.intent_classification.observed[category] || 0,
  }))

  return (
    <CardStatic>
      <CardHeader>
        <CardTitle>{t('semanticPlatform.sections.contextIntent')}</CardTitle>
        <p className="text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.contextIntentDescription')}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <InlineMetric label={t('semanticPlatform.context.strategy')} value={t(`semanticPlatform.context.${data.context_optimizer.strategy}`)} />
          <InlineMetric label={t('semanticPlatform.context.mutation')} value={data.context_optimizer.mutation_allowed ? t('semanticPlatform.status.enabled') : t('semanticPlatform.status.disabled')} tone={data.context_optimizer.mutation_allowed ? 'amber' : 'emerald'} />
          <InlineMetric label={t('semanticPlatform.context.persistence')} value={data.context_optimizer.content_persistence ? t('semanticPlatform.status.enabled') : t('semanticPlatform.status.disabled')} tone="emerald" />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <CountMapPanel title={t('semanticPlatform.context.actions')} values={contextActions} namespace="semanticPlatform.context" />
          <div className="rounded-lg bg-[var(--background-secondary)] p-3">
            <div className="mb-2 text-[10px] font-bold uppercase text-[var(--foreground-dim)]">{t('semanticPlatform.intent.observed')}</div>
            <div className="flex flex-wrap gap-1.5">
              {intentRows.map((row) => (
                <Badge key={row.category} variant={row.count > 0 ? 'blue' : 'zinc'}>
                  {t(`semanticPlatform.intent.${row.category}`)} · {formatNumber(row.count)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </CardStatic>
  )
}

function GuardrailsPanel({ data }: { data: SemanticPlatformResponse }) {
  const { t } = useTranslation('dashboard')
  return (
    <CardStatic>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t('semanticPlatform.sections.guardrails')}</CardTitle>
          <Badge variant={data.guardrails_v2.enabled ? 'emerald' : 'zinc'}>
            {data.guardrails_v2.enabled ? t('semanticPlatform.status.enabled') : t('semanticPlatform.status.disabled')}
          </Badge>
          <Badge variant="emerald">{t('semanticPlatform.privacy.metadataOnly')}</Badge>
        </div>
        <p className="text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.guardrailsDescription')}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {['pii', 'toxicity', 'jailbreak'].map((kind) => (
            <InlineMetric
              key={kind}
              label={t(`semanticPlatform.guardrails.${kind}`)}
              value={formatNumber(data.guardrails_v2.findings[kind] || 0)}
              tone={(data.guardrails_v2.findings[kind] || 0) > 0 ? 'amber' : 'default'}
            />
          ))}
        </div>
      </CardContent>
    </CardStatic>
  )
}

function CountMapPanel({ title, values, namespace }: { title: string; values: Record<string, number>; namespace: string }) {
  const { t } = useTranslation('dashboard')
  const entries = Object.entries(values)
  return (
    <div className="rounded-lg bg-[var(--background-secondary)] p-3">
      <div className="mb-2 text-[10px] font-bold uppercase text-[var(--foreground-dim)]">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.length > 0 ? entries.map(([key, value]) => (
          <Badge key={key} variant={value > 0 ? 'gold' : 'zinc'}>
            {t(`${namespace}.${key}`, { defaultValue: key.replaceAll('_', ' ') })} · {formatNumber(value)}
          </Badge>
        )) : <Badge variant="zinc">{t('semanticPlatform.values.none')}</Badge>}
      </div>
    </div>
  )
}

function InlineMetric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'emerald' | 'amber' }) {
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

export function SemanticPlatformPage() {
  const { t } = useTranslation('dashboard')
  const [period, setPeriod] = useState('7d')
  const semanticPlatform = useSemanticPlatform(period)
  const invalidate = useInvalidateSemanticCache()

  const periodOptions = useMemo(() => [
    { value: '7d', label: t('semanticPlatform.period.7d') },
    { value: '30d', label: t('semanticPlatform.period.30d') },
    { value: '90d', label: t('semanticPlatform.period.90d') },
  ], [t])

  if (semanticPlatform.isError) {
    return <ErrorState error={semanticPlatform.error} onRetry={semanticPlatform.refetch} />
  }

  if (semanticPlatform.isLoading || !semanticPlatform.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('semanticPlatform.title')} description={t('semanticPlatform.description')} icon={BrainCircuit} />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)}
        </div>
        <SkeletonTable rows={5} />
      </div>
    )
  }

  const data = semanticPlatform.data

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('semanticPlatform.title')}
        description={t('semanticPlatform.description')}
        icon={BrainCircuit}
        badge={<Badge variant="emerald">{t('semanticPlatform.badge')}</Badge>}
      >
        <Select options={periodOptions} value={period} onChange={setPeriod} className="w-32" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void semanticPlatform.refetch()
          }}
          disabled={semanticPlatform.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', semanticPlatform.isFetching && 'animate-spin')} />
          {t('semanticPlatform.actions.refresh')}
        </Button>
      </PageHeader>

      <ConceptPanel
        conceptId="semanticControls"
        icon={BrainCircuit}
        badgeKinds={['configDriven', 'runtimeSupported', 'requiresConfig']}
      />

      <PrivacyContract data={data} />

      <div className="stagger-children grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('semanticPlatform.metrics.cacheEntries')} value={formatNumber(data.semantic_cache.entries)} subtitle={data.semantic_cache.backend} icon={DatabaseZap} />
        <MetricCard label={t('semanticPlatform.metrics.promptTemplates')} value={formatNumber(data.prompt_registry.total)} subtitle={t('semanticPlatform.metrics.active', { count: data.prompt_registry.active })} icon={FileCode2} />
        <MetricCard label={t('semanticPlatform.metrics.intentSignals')} value={formatNumber(Object.values(data.intent_classification.observed).reduce((sum, value) => sum + value, 0))} subtitle={data.intent_classification.enabled ? t('semanticPlatform.status.enabled') : t('semanticPlatform.status.disabled')} icon={BrainCircuit} />
        <MetricCard label={t('semanticPlatform.metrics.guardrailFindings')} value={formatNumber(Object.values(data.guardrails_v2.findings).reduce((sum, value) => sum + value, 0))} subtitle={t('semanticPlatform.privacy.metadataOnly')} icon={ShieldCheck} />
      </div>

      <SemanticCachePanel
        data={data}
        invalidating={invalidate.isPending}
        onInvalidate={() => invalidate.mutate({ scope: 'workspace' })}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
        <CardStatic>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-[var(--accent)]" />
              <CardTitle>{t('semanticPlatform.sections.promptRegistry')}</CardTitle>
            </div>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.promptRegistryDescription')}</p>
          </CardHeader>
          <CardContent>
            <PromptRegistryPanel templates={data.prompt_registry.templates} />
          </CardContent>
        </CardStatic>

        <CardStatic>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-[var(--accent)]" />
              <CardTitle>{t('semanticPlatform.sections.createTemplate')}</CardTitle>
            </div>
            <p className="text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.createTemplateDescription')}</p>
          </CardHeader>
          <CardContent>
            <PromptTemplateForm />
          </CardContent>
        </CardStatic>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        <ContextIntentPanel data={data} />
        <GuardrailsPanel data={data} />
      </div>

      <CardStatic>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-[var(--accent)]" />
            <CardTitle>{t('semanticPlatform.sections.routeEvidence')}</CardTitle>
          </div>
          <p className="text-[12px] text-[var(--foreground-dim)]">{t('semanticPlatform.sections.routeEvidenceDescription')}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <PolicyRow label={t('semanticPlatform.evidence.intent')} />
            <PolicyRow label={t('semanticPlatform.evidence.context')} />
            <PolicyRow label={t('semanticPlatform.evidence.promptRegistry')} />
            <PolicyRow label={t('semanticPlatform.evidence.guardrails')} />
          </div>
        </CardContent>
      </CardStatic>
    </div>
  )
}

function PolicyRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] font-semibold text-[var(--foreground)]">
      <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" />
      <span>{label}</span>
    </div>
  )
}

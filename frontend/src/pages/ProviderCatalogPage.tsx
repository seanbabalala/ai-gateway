import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, ChevronDown, ChevronUp, ExternalLink, RefreshCw, Search, Tag, WalletCards } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useProviderCatalogProviders } from '@/hooks/use-provider-catalog'
import { cn } from '@/lib/utils'
import type {
  CatalogModel,
  CatalogPricingHygiene,
  CatalogProvider,
  CatalogProvidersResponse,
  CatalogSyncStatus,
} from '@/types/api'

const MODALITY_FILTERS = [
  'all',
  'text',
  'vision',
  'image',
  'audio',
  'video',
  'embedding',
  'rerank',
  'realtime',
] as const

type PricingStatus = CatalogPricingHygiene['status'] | 'review'

function modelPricingStatus(model: CatalogModel): PricingStatus {
  const hygiene = model.pricing_hygiene
  if (!hygiene) return model.pricing?.manual_review_required ? 'review' : 'fresh'
  if (hygiene.manual_review_required && hygiene.status === 'fresh') return 'review'
  return hygiene.status
}

function statusVariant(status: PricingStatus) {
  if (status === 'fresh') return 'emerald'
  if (status === 'stale') return 'amber'
  if (status === 'missing' || status === 'invalid') return 'red'
  return 'amber'
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return value === 0 ? '$0' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
}

function inputPrice(model: CatalogModel) {
  return model.pricing?.input_per_1m_tokens ?? model.pricing?.input
}

function outputPrice(model: CatalogModel) {
  return model.pricing?.output_per_1m_tokens ?? model.pricing?.output
}

function pricingUnit(model: CatalogModel) {
  const units = model.pricing?.units
  return friendlyUnit(units?.input_per_1m_tokens || units?.input || model.pricing?.billing_unit || model.pricing?.unit || '-')
}

function friendlyUnit(unit: string) {
  const normalized = unit.replace(/^usd_per_/, '').replaceAll('_', ' ')
  if (normalized === '-') return '-'
  return normalized
    .replace('1m input tokens', '/ 1M input tokens')
    .replace('1m output tokens', '/ 1M output tokens')
    .replace('1m tokens', '/ 1M tokens')
}

function sourceLabel(source: string | null | undefined) {
  if (!source) return 'other'
  if (source === 'builtin-reference' || source === 'builtin-static-placeholder') return 'builtinReference'
  if (source === 'openrouter-public-api') return 'openrouterApi'
  if (source === 'operator_required') return 'operatorRequired'
  if (source.includes('override')) return 'localOverride'
  return 'other'
}

function sourceVariant(source: string | null | undefined): 'zinc' | 'emerald' | 'amber' | 'blue' {
  if (source === 'openrouter-public-api') return 'emerald'
  if (source === 'builtin-reference' || source === 'builtin-static-placeholder') return 'blue'
  if (!source || source === 'operator_required') return 'amber'
  return 'zinc'
}

function refreshSourceVariant(
  source: NonNullable<CatalogProvidersResponse['refresh_sources']>[number],
): 'zinc' | 'emerald' | 'amber' | 'blue' {
  if (source.automatic) return 'emerald'
  if (source.mode === 'docs_review') return 'blue'
  if (source.mode === 'operator_local') return 'amber'
  return 'zinc'
}

function syncStatusVariant(status: CatalogSyncStatus['providers'][number]['status']): 'zinc' | 'emerald' | 'amber' | 'red' | 'blue' {
  if (status === 'fresh' || status === 'synced') return 'emerald'
  if (status === 'stale' || status === 'never_synced') return 'amber'
  if (status === 'failed') return 'red'
  if (status === 'manual_only') return 'blue'
  return 'zinc'
}

function modelMatches(model: CatalogModel, query: string, modality: string) {
  const q = query.trim().toLowerCase()
  const matchesQuery =
    q.length === 0 ||
    model.id.toLowerCase().includes(q) ||
    model.provider_id.toLowerCase().includes(q) ||
    model.capabilities.some((capability) => capability.toLowerCase().includes(q))
  const matchesModality = modality === 'all' || (model.modalities as string[]).includes(modality)
  return matchesQuery && matchesModality
}

function providerHasVisibleModels(provider: CatalogProvider, query: string, modality: string) {
  return provider.models.some((model) => modelMatches(model, query, modality))
}

export function ProviderCatalogPage() {
  const { t } = useTranslation('nodes')
  const catalog = useProviderCatalogProviders()
  const [query, setQuery] = useState('')
  const [modality, setModality] = useState<(typeof MODALITY_FILTERS)[number]>('all')

  const providers = catalog.data?.providers || []
  const visibleProviders = useMemo(
    () => providers.filter((provider) => providerHasVisibleModels(provider, query, modality)),
    [providers, query, modality],
  )
  const allModels = providers.flatMap((provider) => provider.models)
  const staleCount = allModels.filter((model) => modelPricingStatus(model) === 'stale').length
  const reviewCount = allModels.filter((model) => model.pricing?.manual_review_required).length
  const overriddenCount = providers.filter((provider) => provider.overridden || provider.tags?.includes('override')).length +
    allModels.filter((model) => model.overridden).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('catalogPage.title')}
        description={t('catalogPage.description')}
        icon={Boxes}
      >
        <Button variant="outline" size="sm" onClick={() => catalog.refetch()} disabled={catalog.isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5', catalog.isFetching && 'animate-spin')} />
          {t('catalogPage.refresh')}
        </Button>
      </PageHeader>

      {catalog.isLoading && (
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {catalog.isError && (
        <ErrorState
          error={catalog.error instanceof Error ? catalog.error : new Error(t('catalogPage.errorMessage'))}
          onRetry={() => { void catalog.refetch() }}
        />
      )}

      {catalog.data && (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <CatalogMetric label={t('catalogPage.metrics.providers')} value={providers.length} icon={Boxes} />
            <CatalogMetric label={t('catalogPage.metrics.models')} value={allModels.length} icon={Tag} />
            <CatalogMetric label={t('catalogPage.metrics.overrides')} value={overriddenCount} icon={Tag} tone={overriddenCount > 0 ? 'emerald' : 'zinc'} />
            <CatalogMetric label={t('catalogPage.metrics.review')} value={reviewCount} icon={WalletCards} tone="amber" />
            <CatalogMetric label={t('catalogPage.metrics.stale')} value={staleCount} icon={WalletCards} tone={staleCount > 0 ? 'amber' : 'emerald'} />
          </div>

          {catalog.data.sync_status && <CatalogSyncStatusCard status={catalog.data.sync_status} />}

          <CatalogRefreshSources sources={catalog.data.refresh_sources || []} />

          <Card>
            <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('catalogPage.tableTitle')}</CardTitle>
                <p className="mt-1 text-[12px] text-[var(--foreground-dim)]">
                  {t('catalogPage.overrideFile', {
                    file: catalog.data.override_file || 'catalog.override.yaml',
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-[240px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--foreground-dim)]" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('catalogPage.search')}
                    className="pl-9"
                  />
                </div>
                <div className="flex max-w-full flex-wrap gap-1 rounded-lg bg-[var(--background-secondary)] p-1">
                  {MODALITY_FILTERS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setModality(item)}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-all',
                        modality === item
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--foreground-dim)] hover:text-[var(--foreground)]',
                      )}
                    >
                      {t(`catalogPage.modalities.${item}`)}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {visibleProviders.length === 0 ? (
                <EmptyState
                  title={t('catalogPage.emptyTitle')}
                  description={t('catalogPage.emptyDescription')}
                  icon={Boxes}
                />
              ) : (
                <div className="space-y-5">
                  {visibleProviders.map((provider) => (
                    <ProviderPricingTable
                      key={provider.id}
                      provider={provider}
                      query={query}
                      modality={modality}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function CatalogSyncStatusCard({ status }: { status: CatalogSyncStatus }) {
  const { t } = useTranslation('nodes')
  const openRouter = status.providers.find((provider) => provider.provider === 'openrouter')
  const enabledCount = status.enabled_adapters.length
  const failedCount = status.providers.filter((provider) => provider.status === 'failed').length
  const staleCount = status.providers.filter((provider) => provider.stale).length
  const visibleProviders = status.providers
    .filter((provider) => provider.enabled || provider.supported || provider.status === 'failed')
    .slice(0, 4)

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>{t('catalogPage.sync.title')}</CardTitle>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-dim)]">
            {t('catalogPage.sync.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          <Badge variant={status.scheduled ? 'emerald' : 'zinc'}>
            {status.scheduled ? t('catalogPage.sync.scheduled') : t('catalogPage.sync.disabled')}
          </Badge>
          <Badge variant={status.write_to === 'cache' ? 'blue' : 'amber'}>
            {t(`catalogPage.sync.writeTargets.${status.write_to}`)}
          </Badge>
          {failedCount > 0 && (
            <Badge variant="red">{t('catalogPage.sync.failedCount', { count: failedCount })}</Badge>
          )}
          {staleCount > 0 && (
            <Badge variant="amber">{t('catalogPage.sync.staleCount', { count: staleCount })}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-lg bg-[var(--background-secondary)] p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <SyncFact label={t('catalogPage.sync.enabledAdapters')} value={String(enabledCount)} />
              <SyncFact
                label={t('catalogPage.sync.interval')}
                value={t('catalogPage.sync.intervalValue', { count: status.interval_minutes })}
              />
              <SyncFact
                label={t('catalogPage.sync.lastOpenRouter')}
                value={openRouter?.last_sync || t('catalogPage.sync.never')}
              />
            </div>
            <div className="mt-3 grid gap-2 text-[11px] text-[var(--foreground-dim)]">
              <div className="truncate">
                <span className="font-bold text-[var(--foreground-muted)]">{t('catalogPage.sync.cacheFile')}: </span>
                <span className="font-mono">{status.cache_file}</span>
              </div>
              <div className="truncate">
                <span className="font-bold text-[var(--foreground-muted)]">{t('catalogPage.sync.overrideFile')}: </span>
                <span className="font-mono">{status.override_file}</span>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleProviders.map((provider) => (
              <div key={provider.provider} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-extrabold text-[var(--foreground)]">{provider.label}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">{provider.provider}</div>
                  </div>
                  <Badge variant={syncStatusVariant(provider.status)} className="shrink-0 whitespace-nowrap">
                    {t(`catalogPage.sync.status.${provider.status}`)}
                  </Badge>
                </div>
                <div className="mt-2 text-[10px] leading-4 text-[var(--foreground-dim)]">
                  {provider.last_sync
                    ? t('catalogPage.sync.lastSync', { value: provider.last_sync })
                    : t('catalogPage.sync.neverSynced')}
                </div>
                {provider.last_error && (
                  <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-red-500">
                    {provider.last_error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SyncFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">{label}</div>
      <div className="mt-1 truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  )
}

function CatalogMetric({
  label,
  value,
  icon: Icon,
  tone = 'zinc',
}: {
  label: string
  value: number
  icon: typeof Boxes
  tone?: 'zinc' | 'amber' | 'emerald'
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-5">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-[var(--foreground)]">{value}</div>
        </div>
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            tone === 'amber'
              ? 'bg-amber-500/10 text-amber-600'
              : tone === 'emerald'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-[var(--background-tertiary)] text-[var(--foreground-muted)]',
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderPricingTable({
  provider,
  query,
  modality,
}: {
  provider: CatalogProvider
  query: string
  modality: string
}) {
  const { t } = useTranslation('nodes')
  const models = provider.models.filter((model) => modelMatches(model, query, modality))

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background-secondary)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
            <NodeIcon
              providerId={provider.id}
              providerName={provider.name}
              baseUrl={provider.base_url}
              modelIds={provider.models.map((model) => model.id)}
              tags={provider.tags}
              protocol={provider.default_protocol}
              className="h-5 w-5"
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-extrabold text-[var(--foreground)]">{provider.name}</div>
            <div className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">{provider.base_url}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={provider.pricing?.manual_review_required ? 'amber' : 'emerald'} className="whitespace-nowrap">
            {provider.pricing?.manual_review_required ? t('catalogPage.badges.review') : t('catalogPage.badges.ready')}
          </Badge>
          {provider.tags?.includes('override') && <Badge variant="purple">{t('catalogPage.badges.override')}</Badge>}
          <Badge variant={sourceVariant(provider.pricing?.source)} className="whitespace-nowrap">
            {t(`catalogPage.sources.${sourceLabel(provider.pricing?.source)}`, {
              source: provider.pricing?.source || 'model-level',
              defaultValue: provider.pricing?.source || 'model-level',
            })}
          </Badge>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[980px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[32%]">{t('catalogPage.columns.model')}</TableHead>
              <TableHead className="w-[16%]">{t('catalogPage.columns.modalities')}</TableHead>
              <TableHead className="w-[18%]">{t('catalogPage.columns.price')}</TableHead>
              <TableHead className="w-[16%]">{t('catalogPage.columns.freshness')}</TableHead>
              <TableHead className="w-[18%]">{t('catalogPage.columns.source')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => {
              const status = modelPricingStatus(model)
              return (
                <TableRow key={model.id}>
                  <TableCell className="align-top">
                    <div className="break-words font-mono text-[12px] font-semibold text-[var(--foreground)]">{model.id}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {model.capabilities.slice(0, 3).map((capability) => (
                        <Badge key={capability} variant="zinc" className="text-[9px]">{capability}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      {model.modalities.map((item) => (
                        <Badge key={item} variant="blue" className="text-[9px]">{item}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-mono text-[11px] text-[var(--foreground)]">
                      {formatPrice(inputPrice(model))} / {formatPrice(outputPrice(model))}
                    </div>
                    <div className="mt-1 max-w-[220px] text-[10px] leading-4 text-[var(--foreground-dim)]">{pricingUnit(model)}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1">
                      <Badge variant={statusVariant(status)} className="w-fit whitespace-nowrap">
                        {t(`catalogPage.status.${status}`)}
                      </Badge>
                      <span className="text-[10px] text-[var(--foreground-dim)]">
                        {model.pricing_hygiene?.age_days === null || model.pricing_hygiene?.age_days === undefined
                          ? t('catalogPage.ageUnknown')
                          : t('catalogPage.ageDays', { count: model.pricing_hygiene.age_days })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge variant={sourceVariant(model.pricing?.source)} className="max-w-[160px] truncate whitespace-nowrap text-[9px]">
                          {t(`catalogPage.sources.${sourceLabel(model.pricing?.source)}`, {
                            source: model.pricing?.source || '-',
                            defaultValue: model.pricing?.source || '-',
                          })}
                        </Badge>
                        {model.pricing?.source_url && (
                          <a
                            href={model.pricing.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--foreground-dim)] transition-colors hover:text-[var(--accent)]"
                            title={model.pricing.source_url}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-[10px] leading-4 text-[var(--foreground-dim)]">
                        {t('catalogPage.confidence', {
                          confidence: t(`catalogPage.confidenceLevels.${model.pricing?.pricing_confidence || 'unknown'}`),
                        })}
                      </div>
                      <div className="text-[10px] leading-4 text-[var(--foreground-dim)]">
                        {t('catalogPage.sourceType', {
                          type: t(`catalogPage.sourceTypes.${model.pricing?.source_type || 'unknown'}`),
                        })}
                      </div>
                      <div className="text-[10px] leading-4 text-[var(--foreground-dim)]">
                        {model.pricing?.last_verified_at || model.pricing?.retrieved_at || model.pricing?.last_updated || '-'}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function CatalogRefreshSources({
  sources,
}: {
  sources: NonNullable<CatalogProvidersResponse['refresh_sources']>
}) {
  const { t } = useTranslation('nodes')
  const [expanded, setExpanded] = useState(false)
  if (sources.length === 0) return null

  const pinnedProviders = new Set(['openrouter', 'local-override'])
  const sortedSources = [...sources].sort((a, b) => {
    const pinnedA = pinnedProviders.has(a.provider) || a.automatic
    const pinnedB = pinnedProviders.has(b.provider) || b.automatic
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  const collapsedCount = 4
  const visibleSources = expanded ? sortedSources : sortedSources.slice(0, collapsedCount)
  const hiddenCount = Math.max(0, sortedSources.length - visibleSources.length)
  const automaticCount = sources.filter((source) => source.automatic).length
  const docsReviewCount = sources.filter((source) => source.mode === 'docs_review').length
  const localCount = sources.filter((source) => source.mode === 'operator_local').length

  return (
    <Card>
      <CardHeader className="gap-3 pb-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>{t('catalogPage.refreshSources.title')}</CardTitle>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-dim)]">
            {t('catalogPage.refreshSources.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <Badge variant="emerald" className="whitespace-nowrap">
            {automaticCount} {t('catalogPage.refreshSources.automatic')}
          </Badge>
          <Badge variant="blue" className="whitespace-nowrap">
            {docsReviewCount} {t('catalogPage.refreshSources.modes.docs_review')}
          </Badge>
          <Badge variant="amber" className="whitespace-nowrap">
            {localCount} {t('catalogPage.refreshSources.modes.operator_local')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {visibleSources.map((source) => (
            <div
              key={source.provider}
              className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-extrabold text-[var(--foreground)]">{source.label}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    {source.provider}
                  </div>
                </div>
                <Badge variant={refreshSourceVariant(source)} className="shrink-0 whitespace-nowrap">
                  {source.automatic
                    ? t('catalogPage.refreshSources.automatic')
                    : t(`catalogPage.refreshSources.modes.${source.mode}`)}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[11px] leading-5 text-[var(--foreground-dim)]">
                {source.notes}
              </p>
              {source.source_url && (
                <a
                  href={source.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent)]"
                >
                  {t('catalogPage.refreshSources.sourceLink')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
        {sources.length > collapsedCount && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[11px] font-medium text-[var(--foreground-dim)]">
              {t('catalogPage.refreshSources.summary', {
                shown: visibleSources.length,
                total: sources.length,
              })}
              {hiddenCount > 0 ? ` · +${hiddenCount}` : ''}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded
                ? t('catalogPage.refreshSources.showLess')
                : t('catalogPage.refreshSources.showAll', { count: sources.length })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

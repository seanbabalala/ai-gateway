import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, RefreshCw, Search, Tag, WalletCards } from 'lucide-react'
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
import type { CatalogModel, CatalogPricingHygiene, CatalogProvider } from '@/types/api'

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
  return 'zinc'
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return value === 0 ? '$0' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
}

function pricingUnit(model: CatalogModel) {
  const units = model.pricing?.units
  return units?.input || model.pricing?.unit || '-'
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
                <div className="flex rounded-lg bg-[var(--background-secondary)] p-1">
                  {MODALITY_FILTERS.slice(0, 5).map((item) => (
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
    <section className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
            <NodeIcon nodeId={provider.id} protocol={provider.default_protocol} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-extrabold text-[var(--foreground)]">{provider.name}</div>
            <div className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">{provider.base_url}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={provider.pricing?.manual_review_required ? 'amber' : 'emerald'}>
            {provider.pricing?.manual_review_required ? t('catalogPage.badges.review') : t('catalogPage.badges.ready')}
          </Badge>
          {provider.tags?.includes('override') && <Badge variant="purple">{t('catalogPage.badges.override')}</Badge>}
          <Badge variant="zinc">{provider.pricing?.source || 'model-level'}</Badge>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('catalogPage.columns.model')}</TableHead>
            <TableHead>{t('catalogPage.columns.modalities')}</TableHead>
            <TableHead>{t('catalogPage.columns.price')}</TableHead>
            <TableHead>{t('catalogPage.columns.freshness')}</TableHead>
            <TableHead>{t('catalogPage.columns.source')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => {
            const status = modelPricingStatus(model)
            return (
              <TableRow key={model.id}>
                <TableCell>
                  <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">{model.id}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.capabilities.slice(0, 3).map((capability) => (
                      <Badge key={capability} variant="zinc" className="text-[9px]">{capability}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {model.modalities.map((item) => (
                      <Badge key={item} variant="blue" className="text-[9px]">{item}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-mono text-[11px] text-[var(--foreground)]">
                    {formatPrice(model.pricing?.input)} / {formatPrice(model.pricing?.output)}
                  </div>
                  <div className="mt-1 max-w-[240px] truncate text-[10px] text-[var(--foreground-dim)]">{pricingUnit(model)}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={statusVariant(status)}>
                      {t(`catalogPage.status.${status}`)}
                    </Badge>
                    <span className="text-[10px] text-[var(--foreground-dim)]">
                      {model.pricing_hygiene?.age_days === null || model.pricing_hygiene?.age_days === undefined
                        ? t('catalogPage.ageUnknown')
                        : t('catalogPage.ageDays', { count: model.pricing_hygiene.age_days })}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-mono text-[10px] text-[var(--foreground-muted)]">{model.pricing?.source || '-'}</div>
                  <div className="mt-1 text-[10px] text-[var(--foreground-dim)]">
                    {model.pricing?.pricing_confidence || 'unknown'} · {model.pricing?.last_updated || '-'}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

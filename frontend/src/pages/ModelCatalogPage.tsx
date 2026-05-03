import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useModelCatalog } from '@/hooks/use-model-catalog'
import type { ModelCatalogEntry } from '@/types/api'

function formatPrice(entry: ModelCatalogEntry): string {
  if (!entry.pricing) return '-'
  return `$${entry.pricing.input}/${entry.pricing.output}`
}

function formatContext(value: number | undefined): string {
  if (!value) return '-'
  if (value >= 1_000_000) return `${Number(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

function dimensionsLabel(value: number | number[] | undefined): string {
  if (!value) return '-'
  return Array.isArray(value) ? value.join('/') : String(value)
}

export function ModelCatalogPage() {
  const { t } = useTranslation('nodes')
  const { data, isLoading, isError, error, refetch, isFetching } = useModelCatalog()
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('')

  const providers = useMemo(() => {
    const values = Array.from(new Set((data?.models || []).map((entry) => entry.provider))).sort()
    return [
      { value: '', label: t('modelCatalog.filters.allProviders') },
      ...values.map((value) => ({ value, label: value })),
    ]
  }, [data?.models, t])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (data?.models || []).filter((entry) => {
      const matchesProvider = !provider || entry.provider === provider
      const haystack = [
        entry.provider,
        entry.model,
        ...(entry.aliases || []),
        ...entry.modalities,
        ...entry.endpoints,
      ].join(' ').toLowerCase()
      return matchesProvider && (!normalized || haystack.includes(normalized))
    })
  }, [data?.models, provider, query])

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('modelCatalog.title')} description={t('modelCatalog.description')} icon={BookOpen} />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} className="h-28" />)}
        </div>
      </div>
    )
  }

  const warnings = data.diagnostics.filter((item) => item.severity === 'warning')

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('modelCatalog.title')}
        description={t('modelCatalog.description')}
        icon={BookOpen}
        badge={<Badge variant="gold">{t('modelCatalog.readOnly')}</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <Database className="h-3.5 w-3.5" />
              {t('modelCatalog.stats.local')}
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--foreground)]">
              {data.source.builtin_models}
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <RefreshCw className="h-3.5 w-3.5" />
              {t('modelCatalog.stats.remote')}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={data.source.remote_enabled ? 'blue' : 'zinc'}>
                {data.source.remote_enabled ? t('modelCatalog.remote.enabled') : t('modelCatalog.remote.disabled')}
              </Badge>
              <span className="font-mono text-[12px] text-[var(--foreground-dim)]">
                {data.source.remote_models}
              </span>
            </div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('modelCatalog.stats.diagnostics')}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={warnings.length > 0 ? 'amber' : 'emerald'}>
                {warnings.length > 0
                  ? t('modelCatalog.warnings.count', { count: warnings.length })
                  : t('modelCatalog.warnings.none')}
              </Badge>
            </div>
          </CardContent>
        </CardStatic>
      </div>

      {data.diagnostics.length > 0 && (
        <CardStatic>
          <CardHeader>
            <CardTitle>{t('modelCatalog.diagnostics.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.diagnostics.slice(0, 5).map((diagnostic, index) => (
              <div
                key={`${diagnostic.code}-${diagnostic.node || 'global'}-${diagnostic.model || index}`}
                className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-800 dark:text-amber-300"
              >
                <div className="font-semibold">{t(`modelCatalog.diagnostics.codes.${diagnostic.code}`, { defaultValue: diagnostic.code })}</div>
                <div className="mt-1 leading-5">{diagnostic.message}</div>
              </div>
            ))}
          </CardContent>
        </CardStatic>
      )}

      <CardStatic>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>{t('modelCatalog.table.title')}</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--foreground-dim)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('modelCatalog.filters.searchPlaceholder')}
                className="w-full pl-9 sm:w-64"
              />
            </div>
            <Select
              options={providers}
              value={provider}
              onChange={setProvider}
              className="w-full sm:w-44"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              {t('modelCatalog.actions.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t('modelCatalog.empty.title')}
              description={t('modelCatalog.empty.description')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('modelCatalog.table.model')}</TableHead>
                    <TableHead>{t('modelCatalog.table.provider')}</TableHead>
                    <TableHead>{t('modelCatalog.table.capability')}</TableHead>
                    <TableHead>{t('modelCatalog.table.context')}</TableHead>
                    <TableHead>{t('modelCatalog.table.pricing')}</TableHead>
                    <TableHead>{t('modelCatalog.table.quality')}</TableHead>
                    <TableHead>{t('modelCatalog.table.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((entry) => (
                    <TableRow key={`${entry.provider}:${entry.model}`}>
                      <TableCell>
                        <div className="font-mono text-[12px] font-semibold text-[var(--foreground)]">{entry.model}</div>
                        {entry.aliases && entry.aliases.length > 0 && (
                          <div className="mt-1 text-[10px] text-[var(--foreground-dim)]">
                            {entry.aliases.join(', ')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.source === 'remote' ? 'blue' : 'zinc'}>{entry.provider}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[280px] flex-wrap gap-1">
                          {entry.modalities.map((modality) => (
                            <Badge key={modality} variant="zinc">
                              {t(`modalities.${modality}`, { defaultValue: modality })}
                            </Badge>
                          ))}
                          {entry.structured_output && (
                            <Badge variant="emerald">{t('modelCatalog.tokens.structured')}</Badge>
                          )}
                          {entry.supports_streaming && (
                            <Badge variant="blue">{t('capabilityTokens.streaming')}</Badge>
                          )}
                          {entry.supports_realtime && (
                            <Badge variant="blue">{t('capabilityTokens.realtime')}</Badge>
                          )}
                          {entry.supports_rerank && (
                            <Badge variant="blue">{t('capabilityTokens.rerank')}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatContext(entry.max_context_tokens)}
                        {entry.dimensions && (
                          <div className="mt-1 text-[10px] text-[var(--foreground-dim)]">
                            {t('modelCatalog.tokens.dimensions', { value: dimensionsLabel(entry.dimensions) })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                        {formatPrice(entry)}
                      </TableCell>
                      <TableCell>
                        {entry.quality_hint !== undefined ? (
                          <Badge variant="gold">{Math.round(entry.quality_hint * 100)}%</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                        {entry.last_updated_at}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </CardStatic>

      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] px-4 py-3 text-[12px] text-[var(--foreground-dim)]">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        {t('modelCatalog.footer')}
      </div>
    </div>
  )
}

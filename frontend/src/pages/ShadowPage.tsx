import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCompareArrows, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
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
import { useShadowTraffic } from '@/hooks/use-shadow'
import { formatLatency, formatTimestamp, formatTokens } from '@/lib/utils'

export function ShadowPage() {
  const { t } = useTranslation('dashboard')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const { data: namespacesData } = useNamespaces()
  const { data, isLoading, isError, error, refetch } = useShadowTraffic(namespaceFilter || undefined)
  const namespaceOptions = [
    { value: '', label: t('filters.allNamespaces') },
    ...(namespacesData?.namespaces || []).map((namespace) => ({
      value: namespace.id,
      label: namespace.name || namespace.id,
    })),
  ]

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  const status = data?.status
  const recent = data?.recent || []

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('shadow.title')}
        description={t('shadow.description')}
        icon={GitCompareArrows}
      >
        <Select
          options={namespaceOptions}
          value={namespaceFilter}
          onChange={(value) => setNamespaceFilter(value)}
          className="w-44"
        />
      </PageHeader>

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

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('shadow.recentResults')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                      {item.namespace_id || t('shadow.allNamespacesShort')}
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

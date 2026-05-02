import { Activity, ArrowRight, BadgeDollarSign, Gauge, LockKeyhole, ShieldAlert, TrendingDown, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { TierBadge } from '@/components/shared/TierBadge'
import { useRoutingRecommendations } from '@/hooks/use-routing-recommendations'
import { getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { AdaptiveRoutingRecommendation, AdaptiveRouteTargetStats } from '@/types/api'

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function money(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

function typeLabel(type: AdaptiveRoutingRecommendation['type'], t: TFunction): string {
  switch (type) {
    case 'promote_primary':
      return t('adaptiveRecommendations.types.promotePrimary')
    case 'investigate_primary':
      return t('adaptiveRecommendations.types.investigatePrimary')
    case 'collect_more_data':
      return t('adaptiveRecommendations.types.collectMoreData')
  }
}

function typeVariant(type: AdaptiveRoutingRecommendation['type']): 'emerald' | 'amber' | 'zinc' {
  switch (type) {
    case 'promote_primary':
      return 'emerald'
    case 'investigate_primary':
      return 'amber'
    case 'collect_more_data':
      return 'zinc'
  }
}

function TargetPill({ target, muted = false }: { target: { node: string; model: string }; muted?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-md bg-[var(--background-secondary)] px-2.5 py-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: colorWithOpacity(getNodeColor(target.node), muted ? '85' : 'ff') }}
      />
      <span className="truncate text-[11px] font-semibold text-[var(--foreground)]">{target.node}</span>
      <span className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">{target.model}</span>
    </span>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-md bg-[var(--background-secondary)] px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="font-mono text-[13px] font-bold text-[var(--foreground)]">{value}</div>
    </div>
  )
}

function RecommendationRow({ recommendation }: { recommendation: AdaptiveRoutingRecommendation }) {
  const { t } = useTranslation('routing')
  const savings = recommendation.potential_savings
  const confidenceWidth = `${Math.round(recommendation.confidence * 100)}%`

  return (
    <div className="matrix-row rounded-lg px-4 py-4">
      <div className="grid gap-4 xl:grid-cols-[160px_1fr_250px]">
        <div className="space-y-2">
          <TierBadge tier={recommendation.tier} />
          <Badge variant={typeVariant(recommendation.type)} className="w-fit text-[9px]">
            {typeLabel(recommendation.type, t)}
          </Badge>
          <div className="pt-1">
            <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--foreground-dim)]">
              <span>{t('adaptiveRecommendations.confidence')}</span>
              <span className="font-mono">{percent(recommendation.confidence)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: confidenceWidth }} />
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TargetPill target={recommendation.current_primary} muted />
            <ArrowRight className="h-3.5 w-3.5 text-[var(--foreground-dim)]" />
            {recommendation.suggested_primary ? (
              <TargetPill target={recommendation.suggested_primary} />
            ) : (
              <span className="rounded-md bg-[var(--inset-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground-dim)]">
                {t('adaptiveRecommendations.noRouteChange')}
              </span>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
                {t('adaptiveRecommendations.reasons')}
              </div>
              <ul className="space-y-1.5">
                {recommendation.reasons.map((reason) => (
                  <li key={reason} className="text-[12px] leading-relaxed text-[var(--foreground-muted)]">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('adaptiveRecommendations.risks')}
              </div>
              <ul className="space-y-1.5">
                {recommendation.risks.map((risk) => (
                  <li key={risk} className="text-[12px] leading-relaxed text-[var(--foreground-muted)]">
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric icon={BadgeDollarSign} label={t('adaptiveRecommendations.metrics.costPer1k')} value={money(savings.cost_usd_per_1k_calls)} />
          <Metric icon={TrendingDown} label={t('adaptiveRecommendations.metrics.windowCost')} value={money(savings.window_cost_usd)} />
          <Metric icon={Gauge} label={t('adaptiveRecommendations.metrics.p50Saved')} value={`${savings.p50_latency_ms}ms`} />
          <Metric icon={Activity} label={t('adaptiveRecommendations.metrics.p95Saved')} value={`${savings.p95_latency_ms}ms`} />
        </div>
      </div>
    </div>
  )
}

function TargetStatsTable({ targets }: { targets: AdaptiveRouteTargetStats[] }) {
  const { t } = useTranslation('routing')

  if (targets.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--background-secondary)] px-4 py-5 text-[12px] text-[var(--foreground-dim)]">
        {t('adaptiveRecommendations.emptyStats')}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] space-y-1">
        <div className="grid grid-cols-[1.45fr_70px_90px_90px_90px_90px] gap-3 px-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
          <span>{t('adaptiveRecommendations.stats.nodeModel')}</span>
          <span>{t('adaptiveRecommendations.stats.calls')}</span>
          <span>{t('adaptiveRecommendations.stats.success')}</span>
          <span>{t('adaptiveRecommendations.stats.fallback')}</span>
          <span>{t('adaptiveRecommendations.stats.p95')}</span>
          <span>{t('adaptiveRecommendations.metrics.costPer1k')}</span>
        </div>
        {targets.slice(0, 6).map((target) => (
          <div
            key={target.key}
            className="grid grid-cols-[1.45fr_70px_90px_90px_90px_90px] gap-3 rounded-md bg-[var(--background-secondary)] px-2 py-2.5 text-[11px]"
          >
            <TargetPill target={target} />
            <span className="font-mono text-[var(--foreground)]">{target.calls}</span>
            <span className="font-mono text-[var(--foreground)]">{percent(target.success_rate)}</span>
            <span className="font-mono text-[var(--foreground-muted)]">{percent(target.fallback_rate)}</span>
            <span className="font-mono text-[var(--foreground-muted)]">{target.p95_latency_ms}ms</span>
            <span className="font-mono text-[var(--foreground-muted)]">{money(target.cost_per_1k_calls_usd)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdaptiveRoutingRecommendations() {
  const { t } = useTranslation('routing')
  const { data, isLoading, isError, error, refetch } = useRoutingRecommendations()

  if (isLoading) {
    return (
      <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] p-5 shadow-[var(--card-shadow)]">
        <Skeleton className="mb-4 h-4 w-52" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] shadow-[var(--card-shadow)]">
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </div>
    )
  }

  if (!data) return null

  const stats = data.stats
  const actionable = data.recommendations.filter((rec) => rec.type !== 'collect_more_data').length

  return (
    <div className="animate-fade-up space-y-4 rounded-lg bg-[var(--glass-bg)] p-5 shadow-[var(--card-shadow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-bold text-[var(--foreground)]">{t('adaptiveRecommendations.title')}</h3>
            <Badge variant="gold" className="gap-1 text-[9px]">
              <LockKeyhole className="h-3 w-3" />
              {t('adaptiveRecommendations.readOnly')}
            </Badge>
          </div>
          <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--foreground-dim)]">
            {t('adaptiveRecommendations.description')}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <Metric icon={Activity} label={t('adaptiveRecommendations.metrics.window')} value={`${stats.window_hours}h`} />
          <Metric icon={Gauge} label={t('adaptiveRecommendations.stats.calls')} value={String(stats.observed_calls)} />
          <Metric icon={TrendingDown} label={t('adaptiveRecommendations.metrics.actions')} value={String(actionable)} />
        </div>
      </div>

      <div className="grid gap-3">
        {data.recommendations.map((recommendation) => (
          <RecommendationRow key={recommendation.id} recommendation={recommendation} />
        ))}
      </div>

      <div className="rounded-lg bg-[var(--inset-bg)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
            {t('adaptiveRecommendations.stats.title')}
          </div>
          <span className="font-mono text-[10px] text-[var(--foreground-dim)]">
            {t('adaptiveRecommendations.stats.windowMeta', {
              min: stats.min_samples,
              limit: stats.sample_limit,
            })}
          </span>
        </div>
        <TargetStatsTable targets={stats.targets} />
      </div>
    </div>
  )
}

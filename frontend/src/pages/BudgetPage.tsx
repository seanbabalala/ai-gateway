import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, RotateCcw, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { PermissionTooltip } from '@/components/shared/PermissionTooltip'
import { Card, CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useBudget, useBudgetKeys, type BudgetScope } from '@/hooks/use-budget'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useCacheSavings } from '@/hooks/use-cache-savings'
import { useConfig } from '@/hooks/use-config'
import { useResetBudget } from '@/hooks/use-mutations'
import { hasWorkspaceRole, useWorkspaces } from '@/hooks/use-workspaces'
import { useThemeColors } from '@/lib/theme'
import { formatNumber, formatCost, formatPercent, cn } from '@/lib/utils'
import type { BudgetRule, BudgetPerKeyResponse } from '@/types/api'

// SVG Ring Gauge Component — cinematic styling
function RingGauge({
  label,
  value,
  max,
  format,
  color,
  gaugeBg,
  gaugeText,
  gaugeSubtext,
  opacity = 1,
}: {
  label: string
  value: number
  max: number
  format: (n: number) => string
  color: string
  gaugeBg: string
  gaugeText: string
  gaugeSubtext: string
  opacity?: number
}) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const radius = 70
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  // Dynamic color based on percentage
  const gaugeColor =
    percentage >= 90
      ? '#E55B50'
      : percentage >= 80
        ? '#F0B429'
        : color

  return (
    <div className="flex flex-col items-center" style={{ opacity }}>
      <svg width="180" height="180" viewBox="0 0 180 180">
        {/* Subtle glow behind the arc */}
        <defs>
          <filter id={`glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        {/* Background circle */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={gaugeBg}
          strokeWidth="10"
          opacity="0.6"
        />
        {/* Progress arc */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={gaugeColor}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 90 90)"
          className="transition-all duration-700 ease-out"
          filter={`url(#glow-${label})`}
        />
        {/* Center text */}
        <text
          x="90"
          y="82"
          textAnchor="middle"
          fill={gaugeText}
          fontSize="26"
          fontFamily="Plus Jakarta Sans, sans-serif"
          fontWeight="700"
          letterSpacing="0"
        >
          {formatPercent(percentage)}
        </text>
        <text
          x="90"
          y="104"
          textAnchor="middle"
          fill={gaugeSubtext}
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          {format(value)} / {format(max)}
        </text>
      </svg>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">{label}</div>
    </div>
  )
}

function progressColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-500'
  if (pct >= 50) return 'bg-sky-500'
  return 'bg-emerald-500'
}

function progressGlow(pct: number): string {
  if (pct >= 90) return 'shadow-[0_0_12px_rgba(229,91,80,0.4)]'
  if (pct >= 80) return 'shadow-[0_0_12px_rgba(240,180,41,0.3)]'
  if (pct >= 50) return 'shadow-[0_0_12px_rgba(2,132,199,0.3)]'
  return 'shadow-[0_0_12px_rgba(45,134,89,0.3)]'
}

function BudgetRulesSection({
  rules,
  label,
  resetBudget,
  canAdmin,
}: {
  rules: BudgetRule[]
  label: string
  resetBudget: ReturnType<typeof useResetBudget>
  canAdmin: boolean
}) {
  const { t } = useTranslation('budget')
  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <div
          key={`${label}-${rule.id}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-4"
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--foreground)] capitalize">
                {rule.type.replace(/_/g, ' ')}
              </span>
              {label && (
                <span className="rounded-lg bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold text-[var(--accent)] uppercase tracking-wider">
                  {label}
                </span>
              )}
              {rule.exceeded && (
                <span className="rounded-lg bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
                  {t('rules.exceeded')}
                </span>
              )}
              {rule.alert && !rule.exceeded && (
                <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  {t('rules.warning')}
                </span>
              )}
            </div>
            <PermissionTooltip allowed={canAdmin} requiredRole="admin">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetBudget.mutate(rule.id)}
                disabled={resetBudget.isPending || !rule.id || !canAdmin}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('actions.reset')}
              </Button>
            </PermissionTooltip>
          </div>

          <div className="flex items-center justify-between font-mono text-[10px] text-[var(--foreground-dim)] mb-2">
            <span>
              {rule.type.includes('cost')
                ? formatCost(rule.current)
                : formatNumber(rule.current)}
            </span>
            <span>
              {rule.type.includes('cost')
                ? formatCost(rule.limit)
                : formatNumber(rule.limit)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-[var(--progress-track)] overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-700 ease-out',
                progressColor(rule.percentage),
                progressGlow(rule.percentage)
              )}
              style={{ width: `${Math.min(rule.percentage, 100)}%` }}
            />
          </div>

          <div className="mt-1.5 text-right font-mono text-[10px] text-[var(--foreground-dim)]">
            {t('rules.used', { value: formatPercent(rule.percentage) })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function BudgetPage() {
  const { t } = useTranslation('budget')
  const [selectedKey, setSelectedKey] = useState('')
  const [showCacheDetail, setShowCacheDetail] = useState(false)
  const { data: budgetKeysData } = useBudgetKeys()
  const { data: apiKeysData } = useApiKeys()
  const selectedScope = useMemo<BudgetScope | undefined>(() => {
    if (!selectedKey) return undefined
    if (selectedKey.startsWith('id:')) return { id: selectedKey.slice(3) }
    if (selectedKey.startsWith('name:')) return { name: selectedKey.slice(5) }
    return { name: selectedKey }
  }, [selectedKey])
  const { data: budgetData, isLoading: budgetLoading, isError, error, refetch } = useBudget(selectedScope)
  const { data: cacheSavings } = useCacheSavings(
    '1d',
    'node',
    selectedScope?.id
      ? { id: selectedScope.id }
      : selectedScope?.name
        ? { name: selectedScope.name }
        : undefined,
  )
  const { data: config, isLoading: configLoading } = useConfig()
  const resetBudget = useResetBudget()
  const { data: workspaceState } = useWorkspaces()
  const canAdmin = hasWorkspaceRole(workspaceState?.access, 'admin')
  const colors = useThemeColors()

  const keyOptions = useMemo(() => {
    const generatedById = new Map<string, { id: string; name: string; key_prefix?: string | null }>()
    for (const item of budgetKeysData?.items || []) {
      generatedById.set(item.id, item)
    }
    for (const item of apiKeysData?.items || []) {
      generatedById.set(item.id, item)
    }

    const generatedNames = new Set(Array.from(generatedById.values()).map((item) => item.name))
    const legacyNames = (budgetKeysData?.keys || [])
      .filter((name) => !generatedNames.has(name))
      .sort((a, b) => a.localeCompare(b))

    return [
      { value: '', label: t('filters.allGlobal') },
      ...Array.from(generatedById.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          value: `id:${item.id}`,
          label: `${item.name} · ${item.key_prefix || item.id.slice(0, 8)}`,
        })),
      ...legacyNames.map((name) => ({ value: `name:${name}`, label: t('filters.legacyYaml', { name }) })),
    ]
  }, [apiKeysData?.items, budgetKeysData?.items, budgetKeysData?.keys])

  const selectedLabel = keyOptions.find((opt) => opt.value === selectedKey)?.label || selectedKey
  const selectedName = selectedLabel.split(' · ')[0]

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (budgetLoading || configLoading || !budgetData) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('budget.title')} description={t('budget.description')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <SkeletonCard className="h-64" />
          <SkeletonCard className="h-64" />
        </div>
        <SkeletonCard className="h-48" />
      </div>
    )
  }

  const isPerKeyView = Boolean(selectedKey && 'perKeyRules' in budgetData)
  const globalRules = budgetData.rules
  const perKeyRules = isPerKeyView ? (budgetData as BudgetPerKeyResponse).perKeyRules : []

  const tokenRule = globalRules.find((r) => r.type === 'daily_tokens')
  const costRule = globalRules.find((r) => r.type === 'daily_cost')
  const perKeyTokenRule = perKeyRules.find((r: BudgetRule) => r.type === 'daily_tokens')
  const perKeyCostRule = perKeyRules.find((r: BudgetRule) => r.type === 'daily_cost')

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('budget.title')}
        description={t('budget.description')}
        icon={Wallet}
      >
        <Select
          options={keyOptions}
          value={selectedKey}
          onChange={(v) => setSelectedKey(v)}
          className="w-44"
        />
      </PageHeader>

      <ConceptPanel
        conceptId="budgetScopes"
        icon={Wallet}
        badgeKinds={['runtimeSupported', 'configDriven']}
      />

      {/* Ring Gauges */}
      <div className="stagger-children grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="animate-fade-up flex flex-col items-center justify-center py-10 gap-4">
          {isPerKeyView && perKeyTokenRule ? (
            <>
              <RingGauge
                label={t('gauges.dailyTokensForKey', { key: selectedName })}
                value={perKeyTokenRule.current}
                max={perKeyTokenRule.limit}
                format={formatNumber}
                color="#064B3A"
                gaugeBg={colors.gaugeBg}
                gaugeText={colors.gaugeText}
                gaugeSubtext={colors.gaugeSubtext}
              />
              {tokenRule && (
                <div className="text-[10px] font-mono text-[var(--foreground-dim)]">
                  {t('gauges.globalUsage', {
                    current: formatNumber(tokenRule.current),
                    limit: formatNumber(tokenRule.limit),
                    percentage: formatPercent(tokenRule.percentage),
                  })}
                </div>
              )}
            </>
          ) : tokenRule ? (
            <RingGauge
              label={t('gauges.dailyTokens')}
              value={tokenRule.current}
              max={tokenRule.limit}
              format={formatNumber}
              color="#064B3A"
              gaugeBg={colors.gaugeBg}
              gaugeText={colors.gaugeText}
              gaugeSubtext={colors.gaugeSubtext}
            />
          ) : (
            <div className="text-sm text-[var(--foreground-dim)]">{t('gauges.noTokenRule')}</div>
          )}
        </Card>
        <Card className="animate-fade-up flex flex-col items-center justify-center py-10 gap-4">
          {isPerKeyView && perKeyCostRule ? (
            <>
              <RingGauge
                label={t('gauges.dailyCostForKey', { key: selectedName })}
                value={perKeyCostRule.current}
                max={perKeyCostRule.limit}
                format={formatCost}
                color="#7C3AED"
                gaugeBg={colors.gaugeBg}
                gaugeText={colors.gaugeText}
                gaugeSubtext={colors.gaugeSubtext}
              />
              {costRule && (
                <div className="text-[10px] font-mono text-[var(--foreground-dim)]">
                  {t('gauges.globalUsage', {
                    current: formatCost(costRule.current),
                    limit: formatCost(costRule.limit),
                    percentage: formatPercent(costRule.percentage),
                  })}
                </div>
              )}
            </>
          ) : costRule ? (
            <RingGauge
              label={t('gauges.dailyCost')}
              value={costRule.current}
              max={costRule.limit}
              format={formatCost}
              color="#7C3AED"
              gaugeBg={colors.gaugeBg}
              gaugeText={colors.gaugeText}
              gaugeSubtext={colors.gaugeSubtext}
            />
          ) : (
            <div className="text-sm text-[var(--foreground-dim)]">{t('gauges.noCostRule')}</div>
          )}
          <div className="w-full max-w-sm rounded-xl border border-emerald-500/12 bg-emerald-500/5 px-4 py-3">
            <div className="text-[11px] font-medium text-[var(--foreground-dim)]">
              {t('cache.note')}
            </div>
            <button
              type="button"
              onClick={() => setShowCacheDetail((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:text-emerald-600 dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              {showCacheDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showCacheDetail ? t('cache.hideDetail') : t('cache.showDetail')}
            </button>
            {showCacheDetail && (
              <div className="mt-2 space-y-1 font-mono text-[11px] text-[var(--foreground-muted)]">
                <div>{t('cache.withoutCache', { value: formatCost(cacheSavings?.summary.hypothetical_no_cache_cost_usd || 0) })}</div>
                <div>{t('cache.withCache', { value: formatCost(cacheSavings?.summary.actual_cost_usd || 0) })}</div>
                <div className="text-emerald-700 dark:text-emerald-300">
                  {t('cache.saved', { value: formatCost(cacheSavings?.summary.savings_usd || 0) })}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Model Pricing Table */}
      {config?.models_pricing && (
        <CardStatic className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <CardTitle>{t('pricing.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pricing.model')}</TableHead>
                  <TableHead className="text-right">{t('pricing.input')}</TableHead>
                  <TableHead className="text-right">{t('pricing.output')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(config.models_pricing).map(
                  ([model, pricing]) => (
                    <TableRow key={model}>
                      <TableCell className="font-mono text-[11px] font-medium text-[var(--foreground)]">
                        {model}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                        ${pricing.input.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-[var(--foreground-muted)]">
                        ${pricing.output.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </CardStatic>
      )}

      {/* Budget Rules */}
      <CardStatic className="animate-fade-up" style={{ animationDelay: '240ms' }}>
        <CardHeader>
          <CardTitle>
            {t('rules.title')}
            {isPerKeyView && (
              <span className="ml-2 text-xs font-normal text-[var(--foreground-dim)]">
                {t('rules.showingKey', { key: selectedLabel })}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isPerKeyView && perKeyRules.length === 0 && (
            <EmptyState
              icon={Wallet}
              title={t('rules.noPerKeyTitle')}
              description={t('rules.noPerKeyDescription')}
              className="py-8"
            />
          )}
          {isPerKeyView && perKeyRules.length > 0 && (
            <>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                {t('rules.perKeyLimits', { key: selectedLabel })}
              </div>
              <BudgetRulesSection rules={perKeyRules} label={t('rules.perKeyLabel')} resetBudget={resetBudget} canAdmin={canAdmin} />
              <div className="my-4 border-t border-[var(--border)]" />
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
                {t('rules.globalLimits')}
              </div>
            </>
          )}
          <BudgetRulesSection rules={globalRules} label={isPerKeyView ? t('rules.globalLabel') : ''} resetBudget={resetBudget} canAdmin={canAdmin} />
        </CardContent>
      </CardStatic>
    </div>
  )
}

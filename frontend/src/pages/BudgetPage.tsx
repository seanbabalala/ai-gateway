import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useBudget, useBudgetKeys } from '@/hooks/use-budget'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useConfig } from '@/hooks/use-config'
import { useResetBudget } from '@/hooks/use-mutations'
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
          fontFamily="Outfit, sans-serif"
          fontWeight="700"
          letterSpacing="-0.02em"
        >
          {formatPercent(percentage)}
        </text>
        <text
          x="90"
          y="104"
          textAnchor="middle"
          fill={gaugeSubtext}
          fontSize="10"
          fontFamily="Space Mono, monospace"
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

function BudgetRulesSection({ rules, label, resetBudget }: { rules: BudgetRule[], label: string, resetBudget: any }) {
  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <div
          key={`${label}-${rule.type}`}
          className="rounded-xl bg-[var(--inset-bg)] p-4"
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
                  Exceeded
                </span>
              )}
              {rule.alert && !rule.exceeded && (
                <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Warning
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resetBudget.mutate(rule.type)}
              disabled={resetBudget.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
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
            {formatPercent(rule.percentage)} used
          </div>
        </div>
      ))}
    </div>
  )
}

export function BudgetPage() {
  const [selectedKey, setSelectedKey] = useState('')
  const { data: budgetData, isLoading: budgetLoading } = useBudget(selectedKey || undefined)
  const { data: budgetKeysData } = useBudgetKeys()
  const { data: apiKeysData } = useApiKeys()
  const { data: config, isLoading: configLoading } = useConfig()
  const resetBudget = useResetBudget()
  const colors = useThemeColors()

  // Build key selector options from both budget keys and API keys
  const allKeys = new Set<string>([
    ...(budgetKeysData?.keys || []),
    ...(apiKeysData?.keys || []),
  ])
  const keyOptions = [
    { value: '', label: 'All (Global)' },
    ...[...allKeys].sort().map((k) => ({ value: k, label: k })),
  ]

  if (budgetLoading || configLoading || !budgetData) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
      </div>
    )
  }

  const isPerKeyView = selectedKey && 'perKeyRules' in budgetData
  const globalRules = budgetData.rules
  const perKeyRules = isPerKeyView ? (budgetData as BudgetPerKeyResponse).perKeyRules : []

  const tokenRule = globalRules.find((r) => r.type === 'daily_tokens')
  const costRule = globalRules.find((r) => r.type === 'daily_cost')
  const perKeyTokenRule = perKeyRules.find((r: BudgetRule) => r.type === 'daily_tokens')
  const perKeyCostRule = perKeyRules.find((r: BudgetRule) => r.type === 'daily_cost')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Track token usage, costs, and budget limits"
      >
        <Select
          options={keyOptions}
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="w-44"
        />
      </PageHeader>

      {/* Ring Gauges */}
      <div className="stagger-children grid grid-cols-2 gap-5">
        <Card className="animate-fade-up flex flex-col items-center justify-center py-10 gap-4">
          {isPerKeyView && perKeyTokenRule ? (
            <>
              <RingGauge
                label={`Daily Tokens (${selectedKey})`}
                value={perKeyTokenRule.current}
                max={perKeyTokenRule.limit}
                format={formatNumber}
                color="#D4A947"
                gaugeBg={colors.gaugeBg}
                gaugeText={colors.gaugeText}
                gaugeSubtext={colors.gaugeSubtext}
              />
              {tokenRule && (
                <div className="text-[10px] font-mono text-[var(--foreground-dim)]">
                  Global: {formatNumber(tokenRule.current)} / {formatNumber(tokenRule.limit)} ({formatPercent(tokenRule.percentage)})
                </div>
              )}
            </>
          ) : tokenRule ? (
            <RingGauge
              label="Daily Tokens"
              value={tokenRule.current}
              max={tokenRule.limit}
              format={formatNumber}
              color="#D4A947"
              gaugeBg={colors.gaugeBg}
              gaugeText={colors.gaugeText}
              gaugeSubtext={colors.gaugeSubtext}
            />
          ) : (
            <div className="text-sm text-[var(--foreground-dim)]">No token budget rule</div>
          )}
        </Card>
        <Card className="animate-fade-up flex flex-col items-center justify-center py-10 gap-4">
          {isPerKeyView && perKeyCostRule ? (
            <>
              <RingGauge
                label={`Daily Cost (${selectedKey})`}
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
                  Global: {formatCost(costRule.current)} / {formatCost(costRule.limit)} ({formatPercent(costRule.percentage)})
                </div>
              )}
            </>
          ) : costRule ? (
            <RingGauge
              label="Daily Cost"
              value={costRule.current}
              max={costRule.limit}
              format={formatCost}
              color="#7C3AED"
              gaugeBg={colors.gaugeBg}
              gaugeText={colors.gaugeText}
              gaugeSubtext={colors.gaugeSubtext}
            />
          ) : (
            <div className="text-sm text-[var(--foreground-dim)]">No cost budget rule</div>
          )}
        </Card>
      </div>

      {/* Model Pricing Table */}
      {config?.models_pricing && (
        <CardStatic className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <CardTitle>Model Pricing (per 1M tokens)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Input $/1M</TableHead>
                  <TableHead className="text-right">Output $/1M</TableHead>
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
            Budget Rules
            {isPerKeyView && (
              <span className="ml-2 text-xs font-normal text-[var(--foreground-dim)]">
                — Showing key: {selectedKey}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isPerKeyView && perKeyRules.length > 0 && (
            <>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                Per-Key Limits ({selectedKey})
              </div>
              <BudgetRulesSection rules={perKeyRules} label="per-key" resetBudget={resetBudget} />
              <div className="my-4 border-t border-[var(--border)]" />
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
                Global Limits
              </div>
            </>
          )}
          <BudgetRulesSection rules={globalRules} label={isPerKeyView ? 'global' : ''} resetBudget={resetBudget} />
        </CardContent>
      </CardStatic>
    </div>
  )
}

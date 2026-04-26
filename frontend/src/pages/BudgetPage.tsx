import { RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useBudget } from '@/hooks/use-budget'
import { useConfig } from '@/hooks/use-config'
import { useResetBudget } from '@/hooks/use-mutations'
import { useThemeColors } from '@/lib/theme'
import { formatNumber, formatCost, formatPercent, cn } from '@/lib/utils'

// SVG Ring Gauge Component
function RingGauge({
  label,
  value,
  max,
  format,
  color,
  gaugeBg,
  gaugeText,
  gaugeSubtext,
}: {
  label: string
  value: number
  max: number
  format: (n: number) => string
  color: string
  gaugeBg: string
  gaugeText: string
  gaugeSubtext: string
}) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const radius = 70
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  // Dynamic color based on percentage
  const gaugeColor =
    percentage >= 90
      ? '#ef4444'
      : percentage >= 80
        ? '#f59e0b'
        : color

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="180" viewBox="0 0 180 180">
        {/* Background circle */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={gaugeBg}
          strokeWidth="12"
        />
        {/* Progress arc */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={gaugeColor}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 90 90)"
          className="transition-all duration-500"
        />
        {/* Center text */}
        <text
          x="90"
          y="82"
          textAnchor="middle"
          className="text-2xl font-bold"
          fill={gaugeText}
          fontSize="24"
          fontFamily="Inter, sans-serif"
          fontWeight="700"
        >
          {formatPercent(percentage)}
        </text>
        <text
          x="90"
          y="102"
          textAnchor="middle"
          fill={gaugeSubtext}
          fontSize="11"
          fontFamily="Inter, sans-serif"
        >
          {format(value)} / {format(max)}
        </text>
      </svg>
      <div className="mt-2 text-xs font-medium text-[var(--foreground-muted)]">{label}</div>
    </div>
  )
}

function progressColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-500'
  if (pct >= 50) return 'bg-blue-500'
  return 'bg-emerald-500'
}

export function BudgetPage() {
  const { data: budgetData, isLoading: budgetLoading } = useBudget()
  const { data: config, isLoading: configLoading } = useConfig()
  const resetBudget = useResetBudget()
  const colors = useThemeColors()

  if (budgetLoading || configLoading || !budgetData) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--foreground-dim)]">
        Loading budget...
      </div>
    )
  }

  const tokenRule = budgetData.rules.find((r) => r.type === 'daily_tokens')
  const costRule = budgetData.rules.find((r) => r.type === 'daily_cost')

  return (
    <div className="space-y-8">
      <PageHeader
        title="Budget"
        description="Track token usage, costs, and budget limits"
      />

      {/* Ring Gauges */}
      <div className="grid grid-cols-2 gap-5">
        <Card className="flex items-center justify-center py-8">
          {tokenRule ? (
            <RingGauge
              label="Daily Tokens"
              value={tokenRule.current}
              max={tokenRule.limit}
              format={formatNumber}
              color="#3B82F6"
              gaugeBg={colors.gaugeBg}
              gaugeText={colors.gaugeText}
              gaugeSubtext={colors.gaugeSubtext}
            />
          ) : (
            <div className="text-sm text-[var(--foreground-dim)]">No token budget rule</div>
          )}
        </Card>
        <Card className="flex items-center justify-center py-8">
          {costRule ? (
            <RingGauge
              label="Daily Cost"
              value={costRule.current}
              max={costRule.limit}
              format={formatCost}
              color="#6366F1"
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
        <CardStatic>
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
                      <TableCell className="font-mono text-xs text-[var(--foreground)]">
                        {model}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-[var(--foreground-muted)]">
                        ${pricing.input.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-[var(--foreground-muted)]">
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
      <CardStatic>
        <CardHeader>
          <CardTitle>Budget Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {budgetData.rules.map((rule) => (
              <div
                key={rule.type}
                className="rounded-lg bg-[var(--inset-bg)] p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-medium text-[var(--foreground)] capitalize">
                      {rule.type.replace(/_/g, ' ')}
                    </span>
                    {rule.exceeded && (
                      <span className="ml-2 text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase">
                        Exceeded
                      </span>
                    )}
                    {rule.alert && !rule.exceeded && (
                      <span className="ml-2 text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase">
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

                <div className="flex items-center justify-between text-xs text-[var(--foreground-dim)] mb-1.5">
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
                      'h-full rounded-full transition-all duration-500',
                      progressColor(rule.percentage)
                    )}
                    style={{ width: `${Math.min(rule.percentage, 100)}%` }}
                  />
                </div>

                <div className="mt-1 text-right text-[11px] text-[var(--foreground-dim)]">
                  {formatPercent(rule.percentage)} used
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </CardStatic>
    </div>
  )
}

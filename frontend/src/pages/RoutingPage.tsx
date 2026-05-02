import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Pencil, Save, X, Plus, Trash2, GripVertical, FlaskConical, GitFork } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SkeletonCard, Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { RoutingRecommendation } from '@/components/routing/RoutingRecommendation'
import { AdaptiveRoutingRecommendations } from '@/components/routing/AdaptiveRoutingRecommendations'
import { useConfig } from '@/hooks/use-config'
import { useNodes } from '@/hooks/use-nodes'
import { apiPut } from '@/lib/api'
import { TIER_CHART_COLORS, getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { TierRoute, RoutingConfig, ActionResponse, SplitVariant } from '@/types/api'

// ── Types ──

interface EditableTiers {
  [tier: string]: TierRoute
}

interface EditableScoring {
  simple_max: number
  standard_max: number
  complex_max: number
}

interface EditableDomainPrefs {
  [domain: string]: string[]
}

// ── Page ──

export function RoutingPage() {
  const { t } = useTranslation('routing')
  const { data: config, isLoading: configLoading } = useConfig()
  const { data: nodesData, isLoading: nodesLoading } = useNodes()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [editTiers, setEditTiers] = useState<EditableTiers>({})
  const [editScoring, setEditScoring] = useState<EditableScoring>({ simple_max: 0, standard_max: 0, complex_max: 0 })
  const [editDomainPrefs, setEditDomainPrefs] = useState<EditableDomainPrefs>({})
  const [addDomainOpen, setAddDomainOpen] = useState(false)
  const [addDomainName, setAddDomainName] = useState('')
  const saveMutation = useMutation({
    mutationFn: (data: { tiers: EditableTiers; scoring: EditableScoring; domain_preferences: EditableDomainPrefs }) =>
      apiPut<ActionResponse>('/api/dashboard/routing', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      setEditing(false)
    },
  })

  const startEditing = useCallback(() => {
    if (!config) return
    const { routing } = config
    setEditTiers(JSON.parse(JSON.stringify(routing.tiers)))
    setEditScoring({ ...routing.scoring })
    setEditDomainPrefs(JSON.parse(JSON.stringify(routing.domain_preferences || {})))
    setEditing(true)
  }, [config])

  const cancelEditing = useCallback(() => {
    setEditing(false)
    saveMutation.reset()
  }, [saveMutation])

  const handleSave = useCallback(() => {
    saveMutation.mutate({
      tiers: editTiers,
      scoring: editScoring,
      domain_preferences: editDomainPrefs,
    })
  }, [editTiers, editScoring, editDomainPrefs, saveMutation])

  if (configLoading || nodesLoading || !config) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('routing.title')} description={t('routing.description')} />
        <div className="glass-card-static rounded-lg p-6">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-64" />)}
        </div>
      </div>
    )
  }

  const { routing } = config
  const allNodes = nodesData?.nodes ?? []
  // Build node→models lookup
  const nodeModels: Record<string, string[]> = {}
  for (const n of allNodes) {
    nodeModels[n.id] = n.models
  }
  const nodeOptions = allNodes.map((n) => ({ value: n.id, label: n.id }))

  const displayTiers = editing ? editTiers : routing.tiers
  const displayScoring = editing ? editScoring : routing.scoring
  const displayDomainPrefs = editing ? editDomainPrefs : (routing.domain_preferences || {})
  const tierNames = Object.keys(displayTiers)

  // Scoring visualization
  const thresholds = [
    { label: 'simple', max: displayScoring.simple_max, color: TIER_CHART_COLORS.simple },
    { label: 'standard', max: displayScoring.standard_max, color: TIER_CHART_COLORS.standard },
    { label: 'complex', max: displayScoring.complex_max, color: TIER_CHART_COLORS.complex },
    { label: 'reasoning', max: 1.0, color: TIER_CHART_COLORS.reasoning },
  ]
  const minScore = -0.5
  const maxScore = 1.0
  const range = maxScore - minScore
  function scoreToPercent(score: number): number {
    return ((score - minScore) / range) * 100
  }

  function scoringFieldLabel(field: keyof EditableScoring): string {
    return t(`scoring.fields.${field}`)
  }

  // ── Edit helpers ──

  function updateTierPrimary(tierName: string, field: 'node' | 'model', value: string) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      tier.primary = { ...tier.primary, [field]: value }
      // When node changes, auto-select first model of that node
      if (field === 'node' && nodeModels[value]?.length) {
        tier.primary.model = nodeModels[value][0]
      }
      return { ...prev, [tierName]: tier }
    })
  }

  function updateFallback(tierName: string, index: number, field: 'node' | 'model', value: string) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      const fallbacks = [...tier.fallbacks]
      fallbacks[index] = { ...fallbacks[index], [field]: value }
      if (field === 'node' && nodeModels[value]?.length) {
        fallbacks[index].model = nodeModels[value][0]
      }
      tier.fallbacks = fallbacks
      return { ...prev, [tierName]: tier }
    })
  }

  function addFallback(tierName: string) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      const firstNode = allNodes[0]
      tier.fallbacks = [...tier.fallbacks, { node: firstNode?.id ?? '', model: firstNode?.models[0] ?? '' }]
      return { ...prev, [tierName]: tier }
    })
  }

  function removeFallback(tierName: string, index: number) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      tier.fallbacks = tier.fallbacks.filter((_, i) => i !== index)
      return { ...prev, [tierName]: tier }
    })
  }

  function moveFallback(tierName: string, fromIndex: number, direction: 'up' | 'down') {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      const fb = [...tier.fallbacks]
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
      if (toIndex < 0 || toIndex >= fb.length) return prev
      ;[fb[fromIndex], fb[toIndex]] = [fb[toIndex], fb[fromIndex]]
      tier.fallbacks = fb
      return { ...prev, [tierName]: tier }
    })
  }

  // ── Split editing helpers ──

  function toggleSplit(tierName: string, enabled: boolean) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      if (enabled) {
        // Initialize split from primary + fallbacks
        const variants: SplitVariant[] = [
          { node: tier.primary.node, model: tier.primary.model, weight: 70, name: 'control' },
        ]
        if (tier.fallbacks.length > 0) {
          const remaining = Math.floor(30 / tier.fallbacks.length)
          tier.fallbacks.forEach((fb, i) => {
            variants.push({
              node: fb.node, model: fb.model,
              weight: i === tier.fallbacks.length - 1 ? 30 - remaining * (tier.fallbacks.length - 1) : remaining,
              name: `variant-${i + 1}`,
            })
          })
        } else {
          variants[0].weight = 100
        }
        tier.split = variants
      } else {
        delete tier.split
      }
      return { ...prev, [tierName]: tier }
    })
  }

  function updateSplitVariant(tierName: string, index: number, field: keyof SplitVariant, value: string | number) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      const split = [...(tier.split || [])]
      split[index] = { ...split[index], [field]: value }
      if (field === 'node' && typeof value === 'string' && nodeModels[value]?.length) {
        split[index].model = nodeModels[value][0]
      }
      tier.split = split
      return { ...prev, [tierName]: tier }
    })
  }

  function addSplitVariant(tierName: string) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      const firstNode = allNodes[0]
      tier.split = [...(tier.split || []), {
        node: firstNode?.id ?? '', model: firstNode?.models[0] ?? '',
        weight: 0, name: '',
      }]
      return { ...prev, [tierName]: tier }
    })
  }

  function removeSplitVariant(tierName: string, index: number) {
    setEditTiers((prev) => {
      const tier = { ...prev[tierName] }
      tier.split = (tier.split || []).filter((_, i) => i !== index)
      if (tier.split.length === 0) delete tier.split
      return { ...prev, [tierName]: tier }
    })
  }

  function getSplitWeightTotal(tierName: string): number {
    const tier = editing ? editTiers[tierName] : displayTiers[tierName]
    if (!tier?.split) return 0
    return tier.split.reduce((sum, v) => sum + v.weight, 0)
  }

  function updateScoringField(field: keyof EditableScoring, value: string) {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      setEditScoring((prev) => ({ ...prev, [field]: num }))
    }
  }

  function addDomainPref() {
    setAddDomainName('')
    setAddDomainOpen(true)
  }

  function confirmAddDomainPref() {
    const name = addDomainName.trim()
    if (name && !(name in editDomainPrefs)) {
      setEditDomainPrefs((prev) => ({ ...prev, [name]: [allNodes[0]?.id ?? ''] }))
    }
    setAddDomainOpen(false)
    setAddDomainName('')
  }

  function removeDomainPref(domain: string) {
    setEditDomainPrefs((prev) => {
      const copy = { ...prev }
      delete copy[domain]
      return copy
    })
  }

  function updateDomainPrefNode(domain: string, index: number, value: string) {
    setEditDomainPrefs((prev) => {
      const nodes = [...(prev[domain] || [])]
      nodes[index] = value
      return { ...prev, [domain]: nodes }
    })
  }

  function addDomainPrefNode(domain: string) {
    setEditDomainPrefs((prev) => {
      const nodes = [...(prev[domain] || []), allNodes[0]?.id ?? '']
      return { ...prev, [domain]: nodes }
    })
  }

  function removeDomainPrefNode(domain: string, index: number) {
    setEditDomainPrefs((prev) => {
      const nodes = (prev[domain] || []).filter((_, i) => i !== index)
      return { ...prev, [domain]: nodes }
    })
  }

  // ── Render helpers ──

  function modelOptionsForNode(nodeId: string) {
    const models = nodeModels[nodeId] || []
    return models.map((m) => ({ value: m, label: m }))
  }

  function renderNodeModelSelector(
    nodeId: string,
    model: string,
    onNodeChange: (v: string) => void,
    onModelChange: (v: string) => void,
  ) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <Select
          className="w-28"
          options={nodeOptions}
          value={nodeId}
          onChange={(v) => onNodeChange(v)}
        />
        <Select
          className="flex-1 font-mono text-[11px]"
          options={modelOptionsForNode(nodeId)}
          value={model}
          onChange={(v) => onModelChange(v)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('routing.title')}
        description={t('routing.description')}
        icon={GitFork}
      >
        {!editing ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
            {t('actions.edit')}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {saveMutation.isError && (
              <span className="text-[12px] text-red-500">
                {(saveMutation.error as Error)?.message || t('actions.saveFailed')}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={cancelEditing}>
              <X className="h-3.5 w-3.5" />
              {t('actions.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Scoring Thresholds */}
      <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] px-5 py-4 shadow-[var(--card-shadow)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-bold text-[var(--foreground)]">{t('scoring.title')}</h3>
          <span className="font-mono text-[10px] text-[var(--foreground-dim)]">{t('scoring.range')}</span>
        </div>
        <div>
          <div className="relative h-12 overflow-hidden rounded-md bg-[var(--background-tertiary)]">
            {thresholds.map((t, i) => {
              const prevMax = i === 0 ? minScore : thresholds[i - 1].max
              const left = scoreToPercent(prevMax)
              const width = scoreToPercent(t.max) - left
              return (
                <div
                  key={t.label}
                  className="absolute top-0 flex h-full items-center justify-center transition-all duration-500"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: colorWithOpacity(t.color, i === 0 ? '28' : '18'),
                  }}
                >
                  <span
                    className="block max-w-full truncate px-1 text-[8px] font-bold uppercase tracking-[0.04em] sm:text-[10px] sm:tracking-[0.12em]"
                    style={{ color: t.color }}
                  >
                    <span className="sm:hidden">{t.label.slice(0, 3)}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                  </span>
                </div>
              )
            })}
          </div>
          {/* Threshold labels / edit inputs */}
          {editing ? (
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(['simple_max', 'standard_max', 'complex_max'] as const).map((field) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--foreground-dim)] w-24 shrink-0">{scoringFieldLabel(field)}:</span>
                  <Input
                    type="number"
                    step="0.01"
                    className="w-24 font-mono text-[12px]"
                    value={editScoring[field]}
                    onChange={(e) => updateScoringField(field, e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative mt-2 h-5">
              {thresholds.slice(0, -1).map((t) => (
                <span
                  key={t.label}
                  className="absolute -translate-x-1/2 font-mono text-[10px] text-[var(--foreground-dim)]"
                  style={{ left: `${scoreToPercent(t.max)}%` }}
                >
                  {t.max}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Routing Recommendation */}
      {!editing && nodesData && (
        <>
          <AdaptiveRoutingRecommendations />
          <RoutingRecommendation nodes={nodesData.nodes} />
        </>
      )}

      {/* Tier Routing Flow */}
      <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] p-3 shadow-[var(--card-shadow)]">
        <div className="mb-2 hidden grid-cols-[130px_1fr_240px] gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)] lg:grid">
          <span>{t('table.tier')}</span>
          <span>{t('table.routeLane')}</span>
          <span>{t('table.trafficMode')}</span>
        </div>
        <div className="space-y-2">
          {tierNames.map((tierName) => {
            const tier = displayTiers[tierName]
            if (!tier) return null
            const tierColor = TIER_CHART_COLORS[tierName] ?? 'var(--accent)'
            const splitTotal = getSplitWeightTotal(tierName)

            return (
              <div
                key={tierName}
                className="matrix-row grid gap-4 rounded-lg px-4 py-4 lg:grid-cols-[130px_1fr_240px] lg:items-start"
              >
                <div className="space-y-2">
                  <TierBadge tier={tierName} />
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--progress-track)]">
                    <div className="h-full rounded-full" style={{ width: '72%', background: tierColor }} />
                  </div>
                </div>

                <div className="min-w-0">
                  {editing ? (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-[var(--background-secondary)] px-3 py-3">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
                          {t('route.primary')}
                        </div>
                        {renderNodeModelSelector(
                          tier.primary.node,
                          tier.primary.model,
                          (v) => updateTierPrimary(tierName, 'node', v),
                          (v) => updateTierPrimary(tierName, 'model', v),
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
                            {t('route.fallbackChain')}
                          </span>
                          <button
                            onClick={() => addFallback(tierName)}
                            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
                          >
                            <Plus className="h-3 w-3" /> {t('route.addFallback')}
                          </button>
                        </div>
                        {tier.fallbacks.map((fb, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--inset-bg)] px-3 py-2">
                            <button
                              onClick={() => moveFallback(tierName, i, 'up')}
                              disabled={i === 0}
                              className="text-[var(--foreground-dim)] transition-colors hover:text-[var(--foreground)] disabled:opacity-20"
                              title={t('route.moveFallback')}
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </button>
                            {renderNodeModelSelector(
                              fb.node,
                              fb.model,
                              (v) => updateFallback(tierName, i, 'node', v),
                              (v) => updateFallback(tierName, i, 'model', v),
                            )}
                            <button
                              onClick={() => removeFallback(tierName, i)}
                              className="rounded-lg p-1.5 text-[var(--foreground-dim)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className="flex min-w-[210px] items-center gap-2 rounded-lg bg-[var(--background-secondary)] px-3 py-2.5"
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: getNodeColor(tier.primary.node) }} />
                        <span className="font-bold text-[var(--foreground)]">{tier.primary.node}</span>
                        <span className="truncate font-mono text-[11px] text-[var(--foreground-dim)]">{tier.primary.model}</span>
                      </div>
                      {tier.fallbacks.map((fb, i) => (
                        <div key={`${fb.node}-${fb.model}-${i}`} className="flex items-center gap-2">
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--divider-dim)]" />
                          <div className="flex min-w-[180px] items-center gap-2 rounded-lg bg-[var(--inset-bg)] px-3 py-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: getNodeColor(fb.node) }} />
                            <span className="font-semibold text-[var(--foreground-muted)]">{fb.node}</span>
                            <span className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">{fb.model}</span>
                          </div>
                        </div>
                      ))}
                      {tier.fallbacks.length === 0 && (
                        <span className="rounded-lg bg-[var(--inset-bg)] px-3 py-2 text-[11px] font-medium text-[var(--foreground-dim)]">
                          {t('route.noFallbackChain')}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-[var(--background-secondary)] px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
                      <FlaskConical className="h-3.5 w-3.5" />
                      {t('split.title')}
                    </div>
                    {editing && (
                      <button
                        onClick={() => toggleSplit(tierName, !tier.split)}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                          tier.split
                            ? 'text-red-500 hover:bg-red-500/10'
                            : 'text-[var(--accent)] hover:bg-[var(--accent-muted)]'
                        }`}
                      >
                        {tier.split ? t('split.disable') : t('split.enable')}
                      </button>
                    )}
                  </div>

                  {tier.split ? (
                    <div className="space-y-2">
                      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--progress-track)]">
                        {tier.split.map((variant, i) => (
                          <div
                            key={`${variant.node}-${i}`}
                            style={{
                              width: `${variant.weight}%`,
                              background: getNodeColor(variant.node),
                            }}
                          />
                        ))}
                      </div>
                      {editing ? (
                        <>
                          {tier.split.map((variant, i) => (
                            <div key={i} className="space-y-2 rounded-md bg-[var(--background-tertiary)] px-2 py-2">
                              <div className="flex items-center gap-2">
                                <Select
                                  className="w-24"
                                  options={nodeOptions}
                                  value={variant.node}
                                  onChange={(val) => updateSplitVariant(tierName, i, 'node', val)}
                                />
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  className="w-16 text-center font-mono text-[11px]"
                                  value={variant.weight}
                                  onChange={(e) => updateSplitVariant(tierName, i, 'weight', parseInt(e.target.value) || 0)}
                                />
                                <span className="text-[10px] text-[var(--foreground-dim)]">%</span>
                                <button
                                  onClick={() => removeSplitVariant(tierName, i)}
                                  className="ml-auto rounded-md p-1.5 text-[var(--foreground-dim)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <Select
                                className="w-full font-mono text-[11px]"
                                options={modelOptionsForNode(variant.node)}
                                value={variant.model}
                                onChange={(val) => updateSplitVariant(tierName, i, 'model', val)}
                              />
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-2">
                            <button
                              onClick={() => addSplitVariant(tierName)}
                              className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
                            >
                              <Plus className="h-3 w-3" /> {t('split.variant')}
                            </button>
                            {splitTotal !== 100 && (
                              <span className="text-[10px] font-semibold text-red-500">
                                {splitTotal}%
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1.5">
                          {tier.split.map((variant, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px]">
                              <span className="h-2 w-2 rounded-full" style={{ background: getNodeColor(variant.node) }} />
                              <span className="truncate font-semibold text-[var(--foreground-muted)]">
                                {variant.name || variant.node}
                              </span>
                              <span className="ml-auto font-mono font-bold text-[var(--foreground)]">{variant.weight}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] font-medium text-[var(--foreground-dim)]">
                      {t('split.primaryFallback')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Domain Preferences */}
      <div className="animate-fade-up rounded-lg bg-[var(--glass-bg)] p-3 shadow-[var(--card-shadow)]" style={{ animationDelay: '300ms' }}>
        <div className="mb-2 flex items-center justify-between gap-3 px-2 py-2">
          <h3 className="text-[14px] font-bold text-[var(--foreground)]">{t('domain.title')}</h3>
          {editing && (
            <button
              onClick={addDomainPref}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
            >
              <Plus className="h-3 w-3" /> {t('domain.addDomain')}
            </button>
          )}
        </div>
        {Object.keys(displayDomainPrefs).length > 0 ? (
          <div className="space-y-2">
            <div
              className={`hidden gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)] lg:grid ${
                editing ? 'lg:grid-cols-[160px_1fr_44px]' : 'lg:grid-cols-[160px_1fr]'
              }`}
            >
              <span>{t('domain.domain')}</span>
              <span>{t('domain.preferredLane')}</span>
              {editing && <span />}
            </div>
            {Object.entries(displayDomainPrefs).map(([domain, nodes]) => (
              <div
                key={domain}
                className={`matrix-row grid gap-3 rounded-lg px-4 py-3 lg:items-center ${
                  editing ? 'lg:grid-cols-[160px_1fr_44px]' : 'lg:grid-cols-[160px_1fr]'
                }`}
              >
                <div>
                  <Badge variant="gold" className="text-[10px]">{domain}</Badge>
                </div>
                <div>
                  {editing ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {nodes.map((nodeId, i) => (
                        <div key={i} className="flex items-center gap-1">
                          {i > 0 && <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />}
                          <Select
                            className="h-7 w-24 text-[11px]"
                            options={nodeOptions}
                            value={nodeId}
                            onChange={(val) => updateDomainPrefNode(domain, i, val)}
                          />
                          <button
                            onClick={() => removeDomainPrefNode(domain, i)}
                            className="cursor-pointer text-[var(--foreground-dim)] transition-colors hover:text-red-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addDomainPrefNode(domain)}
                        className="cursor-pointer rounded-lg p-1 text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {nodes.map((nodeId, i) => (
                        <span key={`${nodeId}-${i}`} className="flex items-center gap-1">
                          {i > 0 && <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />}
                          <Badge
                            variant="default"
                            className="text-[10px]"
                            style={{
                              backgroundColor: colorWithOpacity(getNodeColor(nodeId), '15'),
                              color: getNodeColor(nodeId),
                            }}
                          >
                            {nodeId}
                          </Badge>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {editing && (
                  <button
                    onClick={() => removeDomainPref(domain)}
                    className="w-fit cursor-pointer rounded-lg p-1.5 text-[var(--foreground-dim)] transition-colors hover:bg-red-500/10 hover:text-red-500 lg:ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-3 text-[12px] text-[var(--foreground-dim)]">
            {editing ? t('domain.emptyEditing') : t('domain.empty')}
          </p>
        )}
      </div>

      {/* Add Domain Dialog */}
      <Dialog open={addDomainOpen} onOpenChange={setAddDomainOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('domain.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--foreground-dim)]">
              {t('domain.nameLabel')}
            </label>
            <Input
              value={addDomainName}
              onChange={(e) => setAddDomainName(e.target.value)}
              placeholder={t('domain.placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmAddDomainPref()
                }
              }}
            />
            {addDomainName.trim() && addDomainName.trim() in editDomainPrefs && (
              <p className="text-[11px] text-red-500">{t('domain.exists')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDomainOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              onClick={confirmAddDomainPref}
              disabled={!addDomainName.trim() || addDomainName.trim() in editDomainPrefs}
            >
              {t('domain.addDomain')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

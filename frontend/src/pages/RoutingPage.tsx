import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Pencil, Save, X, Plus, Trash2, GripVertical, FlaskConical } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TierBadge } from '@/components/shared/TierBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Card, CardStatic, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { RoutingRecommendation } from '@/components/routing/RoutingRecommendation'
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
  const { data: config, isLoading: configLoading } = useConfig()
  const { data: nodesData, isLoading: nodesLoading } = useNodes()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [editTiers, setEditTiers] = useState<EditableTiers>({})
  const [editScoring, setEditScoring] = useState<EditableScoring>({ simple_max: 0, standard_max: 0, complex_max: 0 })
  const [editDomainPrefs, setEditDomainPrefs] = useState<EditableDomainPrefs>({})

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
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
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
    const name = prompt('Domain name (e.g. frontend, backend, math):')
    if (name && name.trim() && !(name.trim() in editDomainPrefs)) {
      setEditDomainPrefs((prev) => ({ ...prev, [name.trim()]: [allNodes[0]?.id ?? ''] }))
    }
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
          onChange={(e) => onNodeChange(e.target.value)}
        />
        <Select
          className="flex-1 font-mono text-[11px]"
          options={modelOptionsForNode(nodeId)}
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routing"
        description="Tier-based routing configuration and scoring thresholds"
      >
        {!editing ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {saveMutation.isError && (
              <span className="text-[12px] text-red-500">
                {(saveMutation.error as Error)?.message || 'Save failed'}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={cancelEditing}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Scoring Thresholds */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>Scoring Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-14 rounded-2xl bg-[var(--inset-bg)] overflow-hidden">
            {thresholds.map((t, i) => {
              const prevMax = i === 0 ? minScore : thresholds[i - 1].max
              const left = scoreToPercent(prevMax)
              const width = scoreToPercent(t.max) - left
              return (
                <div
                  key={t.label}
                  className="absolute top-0 h-full flex items-center justify-center transition-all duration-500"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: colorWithOpacity(t.color, '18'),
                    borderRight: i < thresholds.length - 1 ? `2px solid ${colorWithOpacity(t.color, '40')}` : 'none',
                  }}
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.color }}>
                    {t.label}
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
                  <span className="text-[11px] text-[var(--foreground-dim)] w-24 shrink-0">{field.replace('_', ' ')}:</span>
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
        </CardContent>
      </Card>

      {/* Routing Recommendation */}
      {!editing && nodesData && (
        <RoutingRecommendation nodes={nodesData.nodes} />
      )}

      {/* Tier Routing Cards */}
      <div className="stagger-children grid grid-cols-2 gap-5">
        {tierNames.map((tierName) => {
          const tier = displayTiers[tierName]
          if (!tier) return null

          return (
            <CardStatic key={tierName} className="animate-fade-up p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <TierBadge tier={tierName} />
                <span className="text-[11px] font-medium text-[var(--foreground-dim)]">tier</span>
              </div>

              {/* Primary */}
              <div className="mb-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Primary
                </div>
                {editing ? (
                  <div className="rounded-xl border border-[var(--border)] px-3 py-2.5">
                    {renderNodeModelSelector(
                      tier.primary.node,
                      tier.primary.model,
                      (v) => updateTierPrimary(tierName, 'node', v),
                      (v) => updateTierPrimary(tierName, 'model', v),
                    )}
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2.5 rounded-xl border px-4 py-3"
                    style={{
                      borderColor: colorWithOpacity(getNodeColor(tier.primary.node), '25'),
                      backgroundColor: colorWithOpacity(getNodeColor(tier.primary.node), '06'),
                    }}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: getNodeColor(tier.primary.node),
                        boxShadow: `0 0 8px ${colorWithOpacity(getNodeColor(tier.primary.node), '40')}`,
                      }}
                    />
                    <span className="font-semibold text-[var(--foreground)]">{tier.primary.node}</span>
                    <span className="font-mono text-[11px] text-[var(--foreground-dim)]">{tier.primary.model}</span>
                  </div>
                )}
              </div>

              {/* Fallbacks */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                    Fallbacks
                  </span>
                  {editing && (
                    <button
                      onClick={() => addFallback(tierName)}
                      className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors cursor-pointer"
                    >
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {tier.fallbacks.map((fb, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {editing ? (
                        <>
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveFallback(tierName, i, 'up')}
                              disabled={i === 0}
                              className="text-[var(--foreground-dim)] hover:text-[var(--foreground)] disabled:opacity-20 cursor-pointer"
                            >
                              <GripVertical className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="flex-1 rounded-xl border border-[var(--border)] px-3 py-2">
                            {renderNodeModelSelector(
                              fb.node,
                              fb.model,
                              (v) => updateFallback(tierName, i, 'node', v),
                              (v) => updateFallback(tierName, i, 'model', v),
                            )}
                          </div>
                          <button
                            onClick={() => removeFallback(tierName, i)}
                            className="rounded-lg p-1.5 text-[var(--foreground-dim)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />
                          <div className="flex items-center gap-2 rounded-xl bg-[var(--inset-bg)] px-4 py-2.5 flex-1">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getNodeColor(fb.node) }} />
                            <span className="text-sm text-[var(--foreground-muted)]">{fb.node}</span>
                            <span className="font-mono text-[11px] text-[var(--foreground-dim)]">{fb.model}</span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {!editing && tier.fallbacks.length === 0 && (
                    <span className="text-[11px] text-[var(--foreground-dim)] italic">No fallbacks</span>
                  )}
                </div>
              </div>

              {/* A/B Split */}
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                      A/B Split
                    </span>
                  </div>
                  {editing && (
                    <button
                      onClick={() => toggleSplit(tierName, !tier.split)}
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                        tier.split
                          ? 'text-red-500 hover:bg-red-500/10'
                          : 'text-purple-500 hover:bg-purple-500/10'
                      }`}
                    >
                      {tier.split ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </div>

                {tier.split ? (
                  <div className="space-y-2">
                    {/* Weight progress bar (read-only visualization) */}
                    <div className="flex h-5 rounded-full overflow-hidden">
                      {tier.split.map((v, i) => (
                        <div
                          key={i}
                          className="h-full flex items-center justify-center text-[8px] font-bold text-white"
                          style={{
                            width: `${v.weight}%`,
                            backgroundColor: getNodeColor(v.node),
                            minWidth: v.weight > 0 ? '20px' : '0',
                          }}
                        >
                          {v.weight > 10 ? `${v.weight}%` : ''}
                        </div>
                      ))}
                    </div>

                    {editing ? (
                      <>
                        {tier.split.map((v, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
                            <div className="flex items-center gap-2 flex-1">
                              <Select
                                className="w-24"
                                options={nodeOptions}
                                value={v.node}
                                onChange={(e) => updateSplitVariant(tierName, i, 'node', e.target.value)}
                              />
                              <Select
                                className="flex-1 font-mono text-[11px]"
                                options={modelOptionsForNode(v.node)}
                                value={v.model}
                                onChange={(e) => updateSplitVariant(tierName, i, 'model', e.target.value)}
                              />
                            </div>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              className="w-16 text-center font-mono text-[11px]"
                              value={v.weight}
                              onChange={(e) => updateSplitVariant(tierName, i, 'weight', parseInt(e.target.value) || 0)}
                            />
                            <span className="text-[10px] text-[var(--foreground-dim)]">%</span>
                            <Input
                              className="w-24 text-[11px]"
                              placeholder="name"
                              value={v.name || ''}
                              onChange={(e) => updateSplitVariant(tierName, i, 'name', e.target.value)}
                            />
                            <button
                              onClick={() => removeSplitVariant(tierName, i)}
                              className="rounded-lg p-1.5 text-[var(--foreground-dim)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => addSplitVariant(tierName)}
                            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium text-purple-500 hover:bg-purple-500/10 transition-colors cursor-pointer"
                          >
                            <Plus className="h-3 w-3" /> Add Variant
                          </button>
                          {getSplitWeightTotal(tierName) !== 100 && (
                            <span className="text-[10px] font-medium text-red-500">
                              Weights sum to {getSplitWeightTotal(tierName)} (must be 100)
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1">
                        {tier.split.map((v, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getNodeColor(v.node) }} />
                            <span className="text-[var(--foreground-muted)]">{v.name || `${v.node}:${v.model}`}</span>
                            <span className="font-mono text-[var(--foreground-dim)]">{v.node}/{v.model}</span>
                            <Badge variant="default" className="text-[9px] ml-auto">{v.weight}%</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-[var(--foreground-dim)] italic">
                    Not configured — using standard primary + fallback routing
                  </span>
                )}
              </div>
            </CardStatic>
          )
        })}
      </div>

      {/* Domain Preferences */}
      <CardStatic className="animate-fade-up" style={{ animationDelay: '300ms' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Domain Preferences</CardTitle>
            {editing && (
              <button
                onClick={addDomainPref}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" /> Add Domain
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(displayDomainPrefs).length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Preferred Nodes (in order)</TableHead>
                  {editing && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(displayDomainPrefs).map(([domain, nodes]) => (
                  <TableRow key={domain}>
                    <TableCell>
                      <Badge variant="purple">{domain}</Badge>
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {nodes.map((nodeId, i) => (
                            <div key={i} className="flex items-center gap-1">
                              {i > 0 && <ArrowRight className="h-3 w-3 text-[var(--divider-dim)]" />}
                              <Select
                                className="w-24 h-7 text-[11px]"
                                options={nodeOptions}
                                value={nodeId}
                                onChange={(e) => updateDomainPrefNode(domain, i, e.target.value)}
                              />
                              <button
                                onClick={() => removeDomainPrefNode(domain, i)}
                                className="text-[var(--foreground-dim)] hover:text-red-500 cursor-pointer"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addDomainPrefNode(domain)}
                            className="rounded-lg p-1 text-[var(--accent)] hover:bg-[var(--accent-muted)] cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {nodes.map((nodeId, i) => (
                            <span key={nodeId} className="flex items-center gap-1">
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
                    </TableCell>
                    {editing && (
                      <TableCell>
                        <button
                          onClick={() => removeDomainPref(domain)}
                          className="rounded-lg p-1.5 text-[var(--foreground-dim)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-[12px] text-[var(--foreground-dim)]">
              {editing ? 'Click "Add Domain" to create a domain preference.' : 'No domain preferences configured.'}
            </p>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

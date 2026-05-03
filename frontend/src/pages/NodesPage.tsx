import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  RefreshCw,
  RotateCcw,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Type,
  Volume2,
  Server,
  AlertTriangle,
  Boxes,
  Gauge,
  ImageIcon,
  Database,
  ListFilter,
  Radio,
  RadioTower,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusDot } from '@/components/shared/StatusDot'
import { CircuitBadge } from '@/components/shared/CircuitBadge'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { CapabilityBadge } from '@/components/shared/CapabilityBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { NodeFormModal } from '@/components/nodes/NodeFormModal'
import { DeleteNodeDialog } from '@/components/nodes/DeleteNodeDialog'
import { QuickModelReference } from '@/components/nodes/QuickModelReference'
import { useNodes } from '@/hooks/use-nodes'
import {
  useResetCircuit,
  useReloadConfig,
  useCreateNode,
  useUpdateNode,
  useDeleteNode,
} from '@/hooks/use-mutations'
import { getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { ModelCapabilityInfo, NodeInfo, CreateNodeRequest, UpdateNodeRequest } from '@/types/api'

// ── Modality display configuration ──
const MODALITY_DISPLAY: Record<string, {
  labelKey: string
  icon: LucideIcon
  bgClass: string
  borderClass: string
  textClass: string
}> = {
  text: {
    labelKey: 'modalities.text',
    icon: Type,
    bgClass: 'bg-stone-500/10',
    borderClass: 'border-stone-500/20',
    textClass: 'text-stone-600 dark:text-stone-400',
  },
  vision: {
    labelKey: 'modalities.vision',
    icon: Eye,
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    textClass: 'text-purple-700 dark:text-purple-400',
  },
  image: {
    labelKey: 'modalities.image',
    icon: ImageIcon,
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500/30',
    textClass: 'text-indigo-700 dark:text-indigo-400',
  },
  audio: {
    labelKey: 'modalities.audio',
    icon: Volume2,
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/30',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
  video: {
    labelKey: 'modalities.video',
    icon: Video,
    bgClass: 'bg-teal-500/10',
    borderClass: 'border-teal-500/30',
    textClass: 'text-teal-700 dark:text-teal-400',
  },
  embedding: {
    labelKey: 'modalities.embedding',
    icon: Database,
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/30',
    textClass: 'text-sky-700 dark:text-sky-400',
  },
  rerank: {
    labelKey: 'modalities.rerank',
    icon: ListFilter,
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  realtime: {
    labelKey: 'modalities.realtime',
    icon: Radio,
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
}

function modelIdsForNode(node: NodeInfo): string[] {
  return Array.from(new Set([
    ...node.models,
    ...(node.embedding_models || []),
    ...(node.rerank_models || []),
    ...(node.image_models || []),
    ...(node.audio_models || []),
    ...(node.video_models || []),
    ...(node.realtime_models || []),
  ]))
}

function formatLargeNumber(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return `${value}`
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function dimensionsLabel(dimensions: number | number[], t: TFunction): string {
  return Array.isArray(dimensions)
    ? t('capabilityTokens.dimensions', {
        value: `${dimensions.slice(0, 3).join('/')}${dimensions.length > 3 ? '+' : ''}`,
      })
    : t('capabilityTokens.dimensions', { value: dimensions })
}

function capabilityTokens(capability: ModelCapabilityInfo | undefined, t: TFunction): string[] {
  if (!capability) return []
  const tokens: string[] = []
  if (capability.supports_streaming) tokens.push(t('capabilityTokens.streaming'))
  if (capability.supports_realtime) tokens.push(t('capabilityTokens.realtime'))
  if (capability.supports_rerank) tokens.push(t('capabilityTokens.rerank'))
  if (capability.max_context_tokens) tokens.push(t('capabilityTokens.context', { value: formatLargeNumber(capability.max_context_tokens) }))
  if (capability.max_file_size) tokens.push(t('capabilityTokens.file', { value: formatFileSize(capability.max_file_size) }))
  if (capability.dimensions) tokens.push(dimensionsLabel(capability.dimensions, t))
  if (capability.pricing) tokens.push(`$${capability.pricing.input}/${capability.pricing.output}`)
  return tokens
}

export function NodesPage() {
  const { t } = useTranslation('nodes')
  const { data: nodesData, isLoading, isError, error, refetch } = useNodes()
  const resetCircuit = useResetCircuit()
  const reloadConfig = useReloadConfig()
  const createNode = useCreateNode()
  const updateNode = useUpdateNode()
  const deleteNode = useDeleteNode()

  // Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editNode, setEditNode] = useState<NodeInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NodeInfo | null>(null)

  const handleOpenCreate = () => {
    setEditNode(null)
    setFormOpen(true)
  }

  const handleOpenEdit = (node: NodeInfo) => {
    setEditNode(node)
    setFormOpen(true)
  }

  const handleFormSubmit = (data: CreateNodeRequest | UpdateNodeRequest) => {
    if (editNode) {
      updateNode.mutate(
        { nodeId: editNode.id, data: data as UpdateNodeRequest },
        { onSuccess: () => setFormOpen(false) },
      )
    } else {
      createNode.mutate(data as CreateNodeRequest, {
        onSuccess: () => setFormOpen(false),
      })
    }
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    deleteNode.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  if (isLoading || !nodesData) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('nodes.title')} description={t('nodes.description')} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-48" />)}
        </div>
      </div>
    )
  }

  const existingIds = nodesData.nodes.map((n) => n.id)
  const diagnostics = nodesData.diagnostics ?? []
  const healthyCount = nodesData.nodes.filter((node) => node.healthy).length
  const totalModels = nodesData.nodes.reduce((sum, node) => sum + modelIdsForNode(node).length, 0)
  const openCircuitCount = nodesData.nodes.filter((node) => node.circuit.state !== 'CLOSED').length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title={t('nodes.title')}
          description={t('nodes.description')}
          icon={Server}
        />
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reloadConfig.mutate()}
            disabled={reloadConfig.isPending}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${reloadConfig.isPending ? 'animate-spin' : ''}`}
            />
            {reloadConfig.isPending ? t('actions.reloadingConfig') : t('actions.reloadConfig')}
          </Button>
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t('actions.addUpstream')}
          </Button>
        </div>
      </div>

      {diagnostics.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-amber-800 dark:text-amber-300">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold">
                {t('diagnostics.title')}
              </div>
              <div className="mt-1 space-y-1">
                {diagnostics.slice(0, 3).map((diagnostic, idx) => (
                  <p key={`${diagnostic.code}-${diagnostic.model ?? diagnostic.alias ?? idx}`} className="text-[11px] leading-5">
                    {diagnostic.message}
                  </p>
                ))}
                {diagnostics.length > 3 && (
                  <p className="text-[11px] font-medium">
                    {t('diagnostics.moreWarnings', { count: diagnostics.length - 3 })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Model Reference */}
      <div className="animate-fade-up">
        <QuickModelReference nodes={nodesData.nodes} />
      </div>

      <div className="animate-fade-up rounded-lg bg-[#052e24] p-2 shadow-[0_18px_42px_rgba(5,46,36,0.16)] dark:bg-[var(--background-secondary)]">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/10 md:grid-cols-4">
          <div className="bg-[#052e24] px-4 py-3 dark:bg-[var(--background-secondary)]">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white/52">
              <Server className="h-3.5 w-3.5" />
              {t('stats.upstreams')}
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold text-white">
              {nodesData.nodes.length}
            </div>
          </div>
          <div className="bg-[#052e24] px-4 py-3 dark:bg-[var(--background-secondary)]">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white/52">
              <Gauge className="h-3.5 w-3.5" />
              {t('stats.healthy')}
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold text-white">
              {healthyCount}
              <span className="text-sm font-semibold text-white/45"> / {nodesData.nodes.length}</span>
            </div>
          </div>
          <div className="bg-[#052e24] px-4 py-3 dark:bg-[var(--background-secondary)]">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white/52">
              <Boxes className="h-3.5 w-3.5" />
              {t('stats.models')}
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold text-white">
              {totalModels}
            </div>
          </div>
          <div className="bg-[#052e24] px-4 py-3 dark:bg-[var(--background-secondary)]">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white/52">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('stats.openCircuits')}
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold text-white">
              {openCircuitCount}
            </div>
          </div>
        </div>
      </div>

      {/* Node Matrix */}
      {nodesData.nodes.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button size="sm" onClick={handleOpenCreate}>
              <Plus className="h-3.5 w-3.5" />
              {t('actions.addUpstream')}
            </Button>
          }
        />
      ) : (
        <CardStatic className="animate-fade-up overflow-hidden p-3">
          <div className="hidden grid-cols-[minmax(210px,1.1fr)_minmax(260px,1.35fr)_minmax(190px,1fr)_170px_78px] gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)] lg:grid">
            <span>{t('table.upstream')}</span>
            <span>{t('table.models')}</span>
            <span>{t('table.capabilities')}</span>
            <span>{t('table.status')}</span>
            <span className="text-right">{t('table.actions')}</span>
          </div>
          <div className="space-y-2">
            {nodesData.nodes.map((node) => {
              const nodeDiagnostics = diagnostics.filter((diagnostic) =>
                diagnostic.nodes.includes(node.id) || diagnostic.matchingNodes?.includes(node.id),
              )
              const color = getNodeColor(node.id)
              const unhealthyModels = node.models.filter((model) => {
                const circuit = node.modelCircuits?.[model]
                return circuit && circuit.state !== 'CLOSED'
              })
              const concurrency = node.concurrency

              return (
                <div
                  key={node.id}
                  className="matrix-row grid gap-4 rounded-lg px-4 py-4 lg:grid-cols-[minmax(210px,1.1fr)_minmax(260px,1.35fr)_minmax(190px,1fr)_170px_78px] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: colorWithOpacity(color, '12') }}
                      >
                        <NodeIcon
                          nodeId={node.id}
                          protocol={node.protocol}
                          className="h-5 w-5"
                          style={{ color }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-extrabold text-[var(--foreground)]">
                            {node.name}
                          </span>
                          <StatusDot status={node.healthy ? 'healthy' : 'unhealthy'} size="sm" pulse={false} />
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--foreground-dim)]">
                          {node.id} / {node.protocol}
                        </div>
                      </div>
                    </div>
                    {nodeDiagnostics.length > 0 && (
                      <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{nodeDiagnostics[0].message}</span>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {modelIdsForNode(node).slice(0, 5).map((model) => {
                        const mc = node.modelCircuits?.[model]
                        const hasIssue = mc && mc.state !== 'CLOSED'
                        const capability = node.model_capabilities?.[model]
                        const isEmbedding = node.embedding_models?.includes(model)
                        return (
                          <span
                            key={model}
                            className="inline-flex min-w-[118px] max-w-full flex-col items-start gap-1 rounded-md bg-[var(--background-secondary)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--foreground-muted)]"
                          >
                            <span className="flex max-w-full items-center gap-1.5">
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: hasIssue ? 'var(--warning)' : color }}
                              />
                              <span className="truncate font-mono">{model}</span>
                              {isEmbedding && <Badge variant="blue" className="px-1.5 py-0 text-[8px]">{t('capabilityTokens.embeddingShort')}</Badge>}
                              {hasIssue && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    resetCircuit.mutate({ nodeId: node.id, model })
                                  }}
                                  disabled={resetCircuit.isPending}
                                  className="ml-1 text-[var(--foreground-dim)] transition-colors hover:text-[var(--foreground)]"
                                  title={t('actions.resetModelCircuit')}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                            {capability && (
                              <span className="flex max-w-full flex-wrap gap-1">
                                {capability.modalities.slice(0, 3).map((modality) => {
                                  const config = MODALITY_DISPLAY[modality] || MODALITY_DISPLAY.text
                                  return (
                                    <span
                                      key={modality}
                                      className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${config.bgClass} ${config.textClass}`}
                                    >
                                      {t(config.labelKey)}
                                    </span>
                                  )
                                })}
                                {capabilityTokens(capability, t).slice(0, 3).map((token) => (
                                  <span
                                    key={token}
                                    className="rounded bg-[var(--background-tertiary)] px-1.5 py-0.5 text-[8px] font-bold text-[var(--foreground-dim)]"
                                  >
                                    {token}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        )
                      })}
                      {modelIdsForNode(node).length > 5 && (
                        <Badge variant="zinc" className="text-[10px]">+{modelIdsForNode(node).length - 5}</Badge>
                      )}
                    </div>
                    {Object.keys(node.aliases).length > 0 && (
                      <div className="mt-2 truncate text-[10px] text-[var(--foreground-dim)]">
                        {Object.entries(node.aliases).slice(0, 3).map(([alias, target]) => (
                          <span key={alias} className="mr-2">
                            <span className="text-[var(--foreground-muted)]">{alias}</span>
                            <span className="mx-1 text-[var(--divider-dim)]">&rarr;</span>
                            <span className="font-mono">{target}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 space-y-2">
                    {node.capabilities?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {node.capabilities.slice(0, 4).map((cap) => (
                          <CapabilityBadge key={cap} capabilityId={cap} size="sm" />
                        ))}
                        {node.capabilities.length > 4 && (
                          <Badge variant="zinc" className="text-[10px]">+{node.capabilities.length - 4}</Badge>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {node.modalities?.map((modality) => {
                        const config = MODALITY_DISPLAY[modality] || MODALITY_DISPLAY.text
                        const Icon = config.icon
                        return (
                          <span
                            key={modality}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${config.bgClass} ${config.textClass}`}
                          >
                            <Icon className="h-3 w-3" />
                            {t(config.labelKey)}
                          </span>
                        )
                      })}
                      {node.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="zinc" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:block lg:space-y-2">
                    <CircuitBadge state={node.circuit.state} />
                    {concurrency && (
                      <div className="min-w-[132px] rounded-md bg-[var(--background-secondary)] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-semibold text-[var(--foreground-dim)]">
                            {t('status.active')}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-[var(--foreground)]">
                            {concurrency.active}
                            {concurrency.max_concurrency ? ` / ${concurrency.max_concurrency}` : ''}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-semibold text-[var(--foreground-dim)]">
                            {t('status.queued')}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-[var(--foreground)]">
                            {concurrency.queued}
                          </span>
                        </div>
                      </div>
                    )}
                    {node.realtime?.supported && (
                      <div className="min-w-[132px] rounded-md bg-[var(--background-secondary)] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 truncate text-[10px] font-semibold text-[var(--foreground-dim)]">
                            <RadioTower className="h-3 w-3" />
                            {t('realtime.label')}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-[var(--foreground)]">
                            {node.realtime.active_connections}
                            {node.realtime.max_connections_per_node ? ` / ${node.realtime.max_connections_per_node}` : ''}
                          </span>
                        </div>
                        {node.realtime.last_error && (
                          <div className="mt-1 truncate text-[10px] font-semibold text-[var(--warning)]">
                            {node.realtime.last_error}
                          </div>
                        )}
                      </div>
                    )}
                    {node.circuit.consecutiveFailures > 0 && (
                      <div className="font-mono text-[10px] text-[var(--foreground-dim)]">
                        {t('status.failures', { count: node.circuit.consecutiveFailures })}
                      </div>
                    )}
                    {unhealthyModels.length > 0 && (
                      <div className="text-[10px] font-semibold text-[var(--warning)]">
                        {t('status.modelIssues', { count: unhealthyModels.length })}
                      </div>
                    )}
                    {node.circuit.state !== 'CLOSED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetCircuit.mutate({ nodeId: node.id })}
                        disabled={resetCircuit.isPending}
                        className="h-7 px-2 text-[10px]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('actions.reset')}
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 lg:justify-end">
                    <button
                      onClick={() => handleOpenEdit(node)}
                      className="rounded-lg p-2 text-[var(--foreground-dim)] transition-all hover:-translate-y-0.5 hover:bg-[var(--background-secondary)] hover:text-[var(--foreground)] hover:shadow-[0_10px_24px_rgba(5,46,36,0.08)]"
                      title={t('actions.editUpstream')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(node)}
                      className="rounded-lg p-2 text-[var(--foreground-dim)] transition-all hover:-translate-y-0.5 hover:bg-red-500/10 hover:text-red-500"
                      title={t('actions.deleteUpstream')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardStatic>
      )}

      {/* Modals */}
      <NodeFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
        isPending={editNode ? updateNode.isPending : createNode.isPending}
        editNode={editNode}
        existingIds={existingIds}
        existingNodes={nodesData.nodes}
      />

      <DeleteNodeDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteNode.isPending}
        nodeName={deleteTarget?.name ?? ''}
        nodeId={deleteTarget?.id ?? ''}
      />
    </div>
  )
}

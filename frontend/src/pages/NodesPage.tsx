import { useState } from 'react'
import { RefreshCw, RotateCcw, Plus, Pencil, Trash2, Eye, Type, Volume2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusDot } from '@/components/shared/StatusDot'
import { CircuitBadge } from '@/components/shared/CircuitBadge'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { CapabilityBadge } from '@/components/shared/CapabilityBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic } from '@/components/ui/card'
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
import type { NodeInfo, CreateNodeRequest, UpdateNodeRequest } from '@/types/api'

// ── Modality display configuration ──
const MODALITY_DISPLAY: Record<string, {
  label: string
  icon: typeof Eye
  bgClass: string
  borderClass: string
  textClass: string
}> = {
  text: {
    label: 'Text',
    icon: Type,
    bgClass: 'bg-stone-500/10',
    borderClass: 'border-stone-500/20',
    textClass: 'text-stone-600 dark:text-stone-400',
  },
  vision: {
    label: 'Vision',
    icon: Eye,
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    textClass: 'text-purple-700 dark:text-purple-400',
  },
  audio: {
    label: 'Audio',
    icon: Volume2,
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/30',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
}

export function NodesPage() {
  const { data: nodesData, isLoading } = useNodes()
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

  if (isLoading || !nodesData) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-shimmer h-6 w-48 rounded-lg" />
      </div>
    )
  }

  const existingIds = nodesData.nodes.map((n) => n.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Nodes"
          description="AI provider nodes and circuit breaker status"
        />
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reloadConfig.mutate()}
            disabled={reloadConfig.isPending}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${reloadConfig.isPending ? 'animate-spin' : ''}`}
            />
            Reload Config
          </Button>
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add Node
          </Button>
        </div>
      </div>

      {/* Quick Model Reference */}
      <div className="animate-fade-up">
        <QuickModelReference nodes={nodesData.nodes} />
      </div>

      {/* Node Cards Grid */}
      <div className="stagger-children grid grid-cols-2 gap-5">
        {nodesData.nodes.map((node) => (
          <CardStatic key={node.id} className="animate-fade-up p-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{
                    backgroundColor: colorWithOpacity(getNodeColor(node.id), '15'),
                    boxShadow: `0 0 20px ${colorWithOpacity(getNodeColor(node.id), '10')}`,
                  }}
                >
                  <NodeIcon
                    nodeId={node.id}
                    protocol={node.protocol}
                    className="h-5 w-5"
                    style={{ color: getNodeColor(node.id) }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
                      {node.name}
                    </span>
                    <StatusDot
                      status={node.healthy ? 'healthy' : 'unhealthy'}
                      size="sm"
                    />
                  </div>
                  <div className="font-mono text-[10px] text-[var(--foreground-dim)]">
                    {node.id} &middot; {node.protocol}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenEdit(node)}
                  className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all duration-200 hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
                  title="Edit node"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(node)}
                  className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all duration-200 hover:bg-red-500/10 hover:text-red-500"
                  title="Delete node"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Models + Per-Model Circuit Breakers */}
            <div className="mt-4">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                Models
              </div>
              <div className="flex flex-col gap-1.5">
                {node.models.map((model) => {
                  const mc = node.modelCircuits?.[model]
                  const hasIssue = mc && mc.state !== 'CLOSED'
                  return (
                    <div
                      key={model}
                      className="flex items-center justify-between rounded-lg bg-[var(--inset-bg)] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="blue" className="text-[10px]">
                          {model}
                        </Badge>
                        {mc && mc.state !== 'CLOSED' && (
                          <>
                            <CircuitBadge state={mc.state} />
                            {mc.consecutiveFailures > 0 && (
                              <span className="font-mono text-[9px] text-[var(--foreground-dim)]">
                                {mc.consecutiveFailures} failures
                              </span>
                            )}
                          </>
                        )}
                        {(!mc || mc.state === 'CLOSED') && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400">●</span>
                        )}
                      </div>
                      {hasIssue && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            resetCircuit.mutate({ nodeId: node.id, model })
                          }}
                          disabled={resetCircuit.isPending}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--foreground-dim)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--foreground)]"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          Reset
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Capabilities */}
            {node.capabilities && node.capabilities.length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Capabilities
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {node.capabilities.map((cap) => (
                    <CapabilityBadge key={cap} capabilityId={cap} />
                  ))}
                </div>
              </div>
            )}

            {/* Modalities */}
            {node.modalities && node.modalities.length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Modalities
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {node.modalities.map((modality) => {
                    const config = MODALITY_DISPLAY[modality] || MODALITY_DISPLAY.text
                    const Icon = config.icon
                    return (
                      <span
                        key={modality}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold border transition-colors ${config.bgClass} ${config.borderClass} ${config.textClass}`}
                      >
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tags */}
            {node.tags.length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {node.tags.map((tag) => (
                    <Badge key={tag} variant="zinc" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Aliases */}
            {Object.keys(node.aliases).length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                  Aliases
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(node.aliases).map(([alias, target]) => (
                    <span
                      key={alias}
                      className="text-[10px] text-[var(--foreground-dim)]"
                    >
                      <span className="text-[var(--foreground-muted)]">{alias}</span>
                      <span className="mx-1 text-[var(--divider-dim)]">&rarr;</span>
                      <span className="font-mono">{target}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Node-Level Circuit Breaker (Aggregated) */}
            <div className="mt-4 flex items-center justify-between rounded-xl bg-[var(--inset-bg)] px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <CircuitBadge state={node.circuit.state} />
                {node.circuit.consecutiveFailures > 0 && (
                  <span className="font-mono text-[10px] text-[var(--foreground-dim)]">
                    {node.circuit.consecutiveFailures} failures
                  </span>
                )}
              </div>
              {node.circuit.state !== 'CLOSED' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => resetCircuit.mutate({ nodeId: node.id })}
                  disabled={resetCircuit.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset All
                </Button>
              )}
            </div>
          </CardStatic>
        ))}
      </div>

      {/* Modals */}
      <NodeFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
        isPending={editNode ? updateNode.isPending : createNode.isPending}
        editNode={editNode}
        existingIds={existingIds}
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

import { useState } from 'react'
import { RefreshCw, RotateCcw, Plus, Pencil, Trash2 } from 'lucide-react'
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

            {/* Models */}
            <div className="mt-4">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-dim)]">
                Models
              </div>
              <div className="flex flex-wrap gap-1.5">
                {node.models.map((model) => (
                  <Badge key={model} variant="blue" className="text-[10px]">
                    {model}
                  </Badge>
                ))}
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

            {/* Circuit Breaker */}
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
                  onClick={() => resetCircuit.mutate(node.id)}
                  disabled={resetCircuit.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
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

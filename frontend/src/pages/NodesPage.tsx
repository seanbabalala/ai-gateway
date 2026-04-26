import { useState } from 'react'
import { RefreshCw, RotateCcw, Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusDot } from '@/components/shared/StatusDot'
import { CircuitBadge } from '@/components/shared/CircuitBadge'
import { NodeIcon } from '@/components/shared/NodeIcon'
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
      <div className="flex h-64 items-center justify-center text-[var(--foreground-dim)]">
        Loading nodes...
      </div>
    )
  }

  const existingIds = nodesData.nodes.map((n) => n.id)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Nodes"
          description="AI provider nodes and circuit breaker status"
        />
        <div className="flex items-center gap-2">
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
      <QuickModelReference nodes={nodesData.nodes} />

      {/* Node Cards Grid */}
      <div className="grid grid-cols-2 gap-5">
        {nodesData.nodes.map((node) => (
          <CardStatic key={node.id} className="p-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: colorWithOpacity(getNodeColor(node.id), '20') }}
                >
                  <NodeIcon
                    nodeId={node.id}
                    protocol={node.protocol}
                    className="h-4 w-4"
                    style={{ color: getNodeColor(node.id) }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--foreground)]">
                      {node.name}
                    </span>
                    <StatusDot
                      status={node.healthy ? 'healthy' : 'unhealthy'}
                      size="sm"
                    />
                  </div>
                  <div className="text-[11px] text-[var(--foreground-dim)]">
                    {node.id} &middot; {node.protocol}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenEdit(node)}
                  className="rounded-lg p-1.5 text-[var(--foreground-dim)] hover:bg-[var(--background-tertiary)] hover:text-[var(--foreground)]"
                  title="Edit node"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(node)}
                  className="rounded-lg p-1.5 text-[var(--foreground-dim)] hover:bg-red-500/10 hover:text-red-500"
                  title="Delete node"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <Badge variant="default" className="ml-1 text-[10px]">
                  {node.protocol.replace('_', ' ')}
                </Badge>
              </div>
            </div>

            {/* Models */}
            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
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

            {/* Tags */}
            {node.tags.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
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
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-dim)]">
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
            <div className="mt-4 flex items-center justify-between rounded-lg bg-[var(--inset-bg)] px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <CircuitBadge state={node.circuit.state} />
                {node.circuit.consecutiveFailures > 0 && (
                  <span className="text-[11px] text-[var(--foreground-dim)]">
                    {node.circuit.consecutiveFailures} consecutive failures
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

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DeleteNodeDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
  nodeName: string
  nodeId: string
}

export function DeleteNodeDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  nodeName,
  nodeId,
}: DeleteNodeDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Delete Node
            </h3>
            <p className="mt-2 text-sm text-[var(--foreground-muted)]">
              Are you sure you want to delete <strong>{nodeName}</strong> (
              <code className="rounded bg-[var(--background-tertiary)] px-1 py-0.5 text-xs">
                {nodeId}
              </code>
              )?
            </p>
            <p className="mt-2 text-xs text-[var(--foreground-dim)]">
              Routing references to this node will be automatically cleaned up.
              If this node is the primary for a tier, the first fallback will be promoted.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Deleting...' : 'Delete Node'}
          </Button>
        </div>
      </div>
    </div>
  )
}

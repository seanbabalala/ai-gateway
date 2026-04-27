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
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--glass-border)] bg-[var(--background)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
        <div className="flex items-start gap-4">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10"
            style={{ boxShadow: '0 0 24px rgba(229, 91, 80, 0.15)' }}
          >
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">
              Delete Node
            </h3>
            <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">
              Are you sure you want to delete <strong>{nodeName}</strong> (
              <code className="rounded-lg bg-[var(--inset-bg)] px-1.5 py-0.5 font-mono text-[11px]">
                {nodeId}
              </code>
              )?
            </p>
            <p className="mt-2 text-[11px] text-[var(--foreground-dim)]">
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

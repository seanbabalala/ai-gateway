import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'

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
  const { t } = useTranslation('nodes')
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <div className="flex items-start gap-4">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10"
            style={{ boxShadow: '0 0 24px rgba(229, 91, 80, 0.15)' }}
          >
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">
              {t('deleteDialog.title')}
            </h3>
            <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">
              {t('deleteDialog.confirmPrefix')} <strong>{nodeName}</strong> (
              <code className="rounded-lg bg-[var(--inset-bg)] px-1.5 py-0.5 font-mono text-[11px]">
                {nodeId}
              </code>
              )?
            </p>
            <p className="mt-2 text-[11px] text-[var(--foreground-dim)]">
              {t('deleteDialog.description')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('actions.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? t('actions.deleting') : t('actions.deleteUpstream')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

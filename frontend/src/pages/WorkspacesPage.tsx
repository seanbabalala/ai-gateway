import { Building2, CheckCircle2, CircleOff, Pencil, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { DocsLinkGroup, repoDocsUrl } from '@/components/shared/DocsLinkGroup'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hasWorkspaceRole, useWorkspaces } from '@/hooks/use-workspaces'
import { cn, formatDate } from '@/lib/utils'
import type { WorkspaceStatus, WorkspaceSummary } from '@/types/api'

const statusVariants: Record<WorkspaceStatus, 'emerald' | 'zinc'> = {
  active: 'emerald',
  disabled: 'zinc',
}

export function WorkspacesPage() {
  const { t } = useTranslation('common')
  const workspaces = useWorkspaces()
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const canAdmin = hasWorkspaceRole(workspaces.data?.access, 'admin')
  const counts = useMemo(() => {
    const items = workspaces.data?.workspaces || []
    return {
      total: items.length,
      active: items.filter((item) => item.status === 'active').length,
      disabled: items.filter((item) => item.status === 'disabled').length,
    }
  }, [workspaces.data?.workspaces])

  if (!canAdmin && !workspaces.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('workspaces.title')}
          description={t('workspaces.description')}
          icon={Building2}
          badge={<Badge variant="zinc">{t('rbac.roles.viewer')}</Badge>}
        />
        <ConceptPanel
          conceptId="workspaceManagement"
          icon={Building2}
          badgeKinds={['runtimeSupported', 'ossFixedRoles']}
        />
        <CardStatic>
          <EmptyState
            icon={Building2}
            title={t('rbac.denied.title')}
            description={t('rbac.denied.adminWorkspaces')}
          />
        </CardStatic>
      </div>
    )
  }

  async function runAction<T>(key: string, action: () => Promise<T>) {
    setError(null)
    setPendingAction(key)
    try {
      return await action()
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setPendingAction(null)
    }
  }

  function beginEdit(workspace: WorkspaceSummary) {
    setEditingId(workspace.id)
    setEditName(workspace.name)
    setEditSlug(workspace.slug)
  }

  const createDisabled = pendingAction !== null || createName.trim().length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('workspaces.title')}
        description={t('workspaces.description')}
        icon={Building2}
        badge={
          <Badge variant="emerald" className="gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            {t('workspaces.badge.adminManaged')}
          </Badge>
        }
      >
        <Button variant="outline" size="sm" onClick={() => void workspaces.refresh()}>
            <RotateCcw className="h-4 w-4" />
            {t('action.refresh')}
        </Button>
      </PageHeader>

      <ConceptPanel
        conceptId="workspaceManagement"
        icon={Building2}
        badgeKinds={['runtimeSupported', 'ossFixedRoles']}
      />

      <DocsLinkGroup
        links={[
          { label: t('workspaces.docs.concepts'), href: repoDocsUrl('docs/OSS_CONCEPTS.md#workspace') },
          { label: t('workspaces.docs.dashboard'), href: repoDocsUrl('docs/DASHBOARD.md#workspace-rbac') },
          { label: t('workspaces.docs.migration'), href: repoDocsUrl('docs/MIGRATION_V1_TO_V2.md') },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label={t('workspaces.metrics.total')} value={counts.total} />
        <MetricCard label={t('workspaces.metrics.active')} value={counts.active} />
        <MetricCard label={t('workspaces.metrics.disabled')} value={counts.disabled} />
      </div>

      {error && <ErrorState error={error} onRetry={() => setError(null)} />}

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('workspaces.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.5fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              void runAction('create', async () => {
                await workspaces.createWorkspace({
                  name: createName,
                  slug: createSlug || undefined,
                })
                setCreateName('')
                setCreateSlug('')
              })
            }}
          >
            <Input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t('workspaces.create.namePlaceholder')}
            />
            <Input
              value={createSlug}
              onChange={(event) => setCreateSlug(event.target.value)}
              placeholder={t('workspaces.create.slugPlaceholder')}
            />
            <Button type="submit" disabled={createDisabled}>
              <Plus className="h-4 w-4" />
              {pendingAction === 'create' ? t('workspaces.create.creating') : t('workspaces.create.submit')}
            </Button>
          </form>
        </CardContent>
      </CardStatic>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('workspaces.table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {workspaces.isLoading ? (
            <SkeletonTable rows={4} cols={6} />
          ) : workspaces.data?.workspaces.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('workspaces.empty.title')}
              description={t('workspaces.empty.description')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workspaces.table.workspace')}</TableHead>
                  <TableHead>{t('workspaces.table.status')}</TableHead>
                  <TableHead>{t('workspaces.table.default')}</TableHead>
                  <TableHead>{t('workspaces.table.created')}</TableHead>
                  <TableHead>{t('workspaces.table.updated')}</TableHead>
                  <TableHead>{t('workspaces.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.data?.workspaces.map((workspace) => {
                  const editing = editingId === workspace.id
                  const active = workspaces.data?.active_workspace.id === workspace.id
                  return (
                    <TableRow key={workspace.id} className={cn(active && 'bg-[var(--accent-muted)]/35')}>
                      <TableCell>
                        {editing ? (
                          <div className="grid min-w-[260px] gap-2">
                            <Input
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              placeholder={t('workspaces.create.namePlaceholder')}
                            />
                            <Input
                              value={editSlug}
                              onChange={(event) => setEditSlug(event.target.value)}
                              placeholder={t('workspaces.create.slugPlaceholder')}
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
                              {workspace.name}
                              {active && <Badge variant="blue">{t('workspace.activeWorkspace')}</Badge>}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-[var(--foreground-dim)]">
                              {workspace.id} · {workspace.slug}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariants[workspace.status]}>
                          {t(`workspaces.status.${workspace.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {workspace.is_default ? (
                          <Badge variant="gold">{t('workspace.defaultWorkspace')}</Badge>
                        ) : (
                          <span className="text-[12px] text-[var(--foreground-dim)]">
                            {t('workspaces.table.notDefault')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                        {workspace.created_at ? formatDate(workspace.created_at) : '-'}
                      </TableCell>
                      <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                        {workspace.updated_at ? formatDate(workspace.updated_at) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {editing ? (
                            <>
                              <Button
                                size="sm"
                                disabled={pendingAction !== null || editName.trim().length === 0}
                                onClick={() =>
                                  void runAction(`rename:${workspace.id}`, async () => {
                                    await workspaces.renameWorkspace(workspace.id, {
                                      name: editName,
                                      slug: editSlug,
                                    })
                                    setEditingId(null)
                                  })
                                }
                              >
                                {t('action.save')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingAction !== null}
                                onClick={() => setEditingId(null)}
                              >
                                {t('action.cancel')}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={workspace.status !== 'active' || active || pendingAction !== null}
                                onClick={() => void runAction(`switch:${workspace.id}`, () => workspaces.switchWorkspace(workspace.id))}
                              >
                                {t('workspaces.actions.switch')}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={pendingAction !== null}
                                onClick={() => beginEdit(workspace)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t('action.edit')}
                              </Button>
                              {workspace.status === 'active' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={workspace.is_default || pendingAction !== null}
                                  onClick={() => {
                                    if (confirm(t('workspaces.confirm.disable', { name: workspace.name }))) {
                                      void runAction(`disable:${workspace.id}`, () => workspaces.disableWorkspace(workspace.id))
                                    }
                                  }}
                                >
                                  <CircleOff className="h-3.5 w-3.5" />
                                  {t('workspaces.actions.disable')}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled={pendingAction !== null}
                                  onClick={() => void runAction(`reactivate:${workspace.id}`, () => workspaces.reactivateWorkspace(workspace.id))}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {t('workspaces.actions.reactivate')}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <CardStatic>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-dim)]">
            {label}
          </div>
          <Building2 className="h-4 w-4 text-[var(--foreground-dim)]" />
        </div>
        <div className="mt-2 font-mono text-[24px] font-extrabold text-[var(--foreground)]">
          {value}
        </div>
      </CardContent>
    </CardStatic>
  )
}

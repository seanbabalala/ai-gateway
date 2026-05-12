import { Building2, Layers3, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConceptPanel } from '@/components/shared/ConceptPanel'
import { DocsLinkGroup, repoDocsUrl } from '@/components/shared/DocsLinkGroup'
import { GuidanceSection } from '@/components/shared/GuidanceSection'
import { PageHeader } from '@/components/shared/PageHeader'
import { PermissionTooltip } from '@/components/shared/PermissionTooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardStatic, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  useCreateNamespace,
  useDeleteNamespace,
  useNamespaces,
  useUpdateNamespace,
} from '@/hooks/use-namespaces'
import { useNodes } from '@/hooks/use-nodes'
import { hasWorkspaceRole, useWorkspaces } from '@/hooks/use-workspaces'
import { formatNumber } from '@/lib/utils'
import type {
  CreateNamespaceRequest,
  NamespaceInfo,
  NamespaceMutationResponse,
  UpdateNamespaceRequest,
} from '@/types/api'

interface NamespaceFormState {
  id: string
  name: string
  allowed_nodes: string
  allowed_models: string
  daily_token_limit: string
  daily_cost_limit: string
  alert_threshold: string
  requests_per_minute: string
}

const emptyForm: NamespaceFormState = {
  id: '',
  name: '',
  allowed_nodes: '',
  allowed_models: '',
  daily_token_limit: '',
  daily_cost_limit: '',
  alert_threshold: '',
  requests_per_minute: '',
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function formFromNamespace(namespace: NamespaceInfo): NamespaceFormState {
  return {
    id: namespace.id,
    name: namespace.name === namespace.id ? '' : namespace.name,
    allowed_nodes: namespace.allowed_nodes.join(', '),
    allowed_models: namespace.allowed_models.join(', '),
    daily_token_limit: namespace.budget?.daily_token_limit?.toString() || '',
    daily_cost_limit: namespace.budget?.daily_cost_limit?.toString() || '',
    alert_threshold: namespace.budget?.alert_threshold?.toString() || '',
    requests_per_minute: namespace.rate_limit_per_minute?.toString() || '',
  }
}

function buildCreatePayload(form: NamespaceFormState): CreateNamespaceRequest {
  const budget = {
    daily_token_limit: numberOrUndefined(form.daily_token_limit),
    daily_cost_limit: numberOrUndefined(form.daily_cost_limit),
    alert_threshold: numberOrUndefined(form.alert_threshold),
  }
  const rateLimit = {
    requests_per_minute: numberOrUndefined(form.requests_per_minute),
  }
  return {
    id: form.id.trim(),
    name: form.name.trim() || undefined,
    allowed_nodes: splitList(form.allowed_nodes),
    allowed_models: splitList(form.allowed_models),
    budget: Object.values(budget).some((value) => value !== undefined) ? budget : null,
    rate_limit: rateLimit.requests_per_minute !== undefined ? rateLimit : null,
  }
}

function buildUpdatePayload(form: NamespaceFormState): UpdateNamespaceRequest {
  const { id: _id, ...rest } = buildCreatePayload(form)
  return rest
}

function NamespaceFormDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean
  mode: 'create' | 'edit'
  initial: NamespaceFormState
  onClose: () => void
  onSubmit: (form: NamespaceFormState) => void
  pending: boolean
}) {
  const { t } = useTranslation('common')
  const [form, setForm] = useState<NamespaceFormState>(initial)

  useEffect(() => {
    if (open) setForm(initial)
  }, [open, mode, initial.id])

  const canSubmit = mode === 'edit' || form.id.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('namespaces.form.createTitle') : t('namespaces.form.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('namespaces.form.id')}
            </label>
            <Input
              value={form.id}
              disabled={mode === 'edit'}
              onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
              placeholder={t('namespaces.form.idPlaceholder')}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('namespaces.form.name')}
            </label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('namespaces.form.namePlaceholder')}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.allowedNodes')}
              </label>
              <Input
                value={form.allowed_nodes}
                onChange={(event) => setForm((prev) => ({ ...prev, allowed_nodes: event.target.value }))}
                placeholder={t('namespaces.form.csvPlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.allowedModels')}
              </label>
              <Input
                value={form.allowed_models}
                onChange={(event) => setForm((prev) => ({ ...prev, allowed_models: event.target.value }))}
                placeholder={t('namespaces.form.csvPlaceholder')}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.dailyTokens')}
              </label>
              <Input
                type="number"
                min="0"
                value={form.daily_token_limit}
                onChange={(event) => setForm((prev) => ({ ...prev, daily_token_limit: event.target.value }))}
                placeholder={t('namespaces.form.unset')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.dailyCost')}
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.daily_cost_limit}
                onChange={(event) => setForm((prev) => ({ ...prev, daily_cost_limit: event.target.value }))}
                placeholder={t('namespaces.form.unset')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.alertThreshold')}
              </label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={form.alert_threshold}
                onChange={(event) => setForm((prev) => ({ ...prev, alert_threshold: event.target.value }))}
                placeholder="0.8"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('namespaces.form.rpm')}
              </label>
              <Input
                type="number"
                min="1"
                value={form.requests_per_minute}
                onChange={(event) => setForm((prev) => ({ ...prev, requests_per_minute: event.target.value }))}
                placeholder={t('namespaces.form.unset')}
              />
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] p-3 text-[12px] leading-5 text-[var(--foreground-dim)]">
            {t('namespaces.form.validationNote')}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={!canSubmit || pending} onClick={() => onSubmit(form)}>
            {mode === 'create' ? t('namespaces.actions.create') : t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDeleteDialog({
  namespace,
  response,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  namespace: NamespaceInfo | null
  response: NamespaceMutationResponse | null
  open: boolean
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('common')
  const impact = response?.impact || namespace?.bindings
  const apiKeyCount = impact?.counts.api_keys || 0
  const teamCount = impact?.counts.teams || 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('namespaces.delete.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[13px] leading-6 text-[var(--foreground-muted)]">
            {t('namespaces.delete.description', {
              namespace: namespace?.name || namespace?.id || '',
              apiKeys: apiKeyCount,
              teams: teamCount,
            })}
          </p>
          {impact && (
            <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--inset-bg)] p-3 text-[12px]">
              <div className="font-semibold text-[var(--foreground)]">{t('namespaces.delete.impact')}</div>
              <div className="text-[var(--foreground-dim)]">
                {t('namespaces.bindings.apiKeys')}: {apiKeyCount}
              </div>
              <div className="text-[var(--foreground-dim)]">
                {t('namespaces.bindings.teams')}: {teamCount}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            {t('namespaces.actions.confirmDelete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <CardStatic>
      <CardContent className="pt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
          {label}
        </div>
        <div className="mt-2 text-3xl font-bold text-[var(--foreground)]">{formatNumber(value)}</div>
      </CardContent>
    </CardStatic>
  )
}

function ResourceList({ values, fallback }: { values: string[]; fallback: string }) {
  if (values.length === 0) {
    return <span className="text-[12px] text-[var(--foreground-dim)]">{fallback}</span>
  }
  return (
    <div className="flex max-w-sm flex-wrap gap-1.5">
      {values.slice(0, 4).map((value) => (
        <Badge key={value} variant="zinc">{value}</Badge>
      ))}
      {values.length > 4 && <Badge variant="zinc">+{values.length - 4}</Badge>}
    </div>
  )
}

export function NamespacesPage() {
  const { t } = useTranslation('common')
  const namespaces = useNamespaces()
  const nodes = useNodes()
  const workspaces = useWorkspaces()
  const createNamespace = useCreateNamespace()
  const updateNamespace = useUpdateNamespace()
  const deleteNamespace = useDeleteNamespace()
  const canAdmin = hasWorkspaceRole(workspaces.data?.access, 'admin')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<NamespaceInfo | null>(null)
  const [deleting, setDeleting] = useState<NamespaceInfo | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<NamespaceMutationResponse | null>(null)

  const counts = namespaces.data?.counts || {
    total: 0,
    with_budget: 0,
    with_rate_limit: 0,
    bound_api_keys: 0,
    bound_teams: 0,
  }
  const nodeIds = useMemo(
    () => (nodes.data ? new Set(nodes.data.nodes.map((node) => node.id)) : null),
    [nodes.data],
  )

  function handleDelete(namespace: NamespaceInfo) {
    setDeleting(namespace)
    setDeleteImpact({
      success: false,
      message: 'pending',
      impact: namespace.bindings,
    })
  }

  if (namespaces.isError) {
    return <ErrorState error={namespaces.error} onRetry={() => void namespaces.refetch()} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('namespaces.title')}
        description={t('namespaces.description')}
        icon={Layers3}
        badge={<Badge variant="gold">{t('namespaces.badge.configBacked')}</Badge>}
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void namespaces.refetch()}>
            <RotateCcw className="h-4 w-4" />
            {t('action.refresh')}
          </Button>
          <PermissionTooltip allowed={canAdmin} requiredRole="admin">
            <Button onClick={() => setCreateOpen(true)} disabled={!canAdmin}>
              <Plus className="h-4 w-4" />
              {t('namespaces.actions.new')}
            </Button>
          </PermissionTooltip>
        </div>
      </PageHeader>

      <GuidanceSection storageKey="policy-namespaces" complete={counts.total > 0}>
        <div className="grid gap-4 xl:grid-cols-2">
          <ConceptPanel
            conceptId="policyNamespace"
            icon={Layers3}
            badgeKinds={['configDriven', 'runtimeSupported']}
          />
          <ConceptPanel
            conceptId="workspace"
            icon={Building2}
            badgeKinds={['runtimeSupported', 'ossFixedRoles']}
          />
        </div>

        <DocsLinkGroup
          links={[
            { label: t('namespaces.docs.namespaceShadow'), href: repoDocsUrl('docs/NAMESPACES_AND_SHADOW.md') },
            { label: t('namespaces.docs.concepts'), href: repoDocsUrl('docs/OSS_CONCEPTS.md') },
            { label: t('namespaces.docs.api'), href: repoDocsUrl('docs/API_REFERENCE.md#policy-namespace-management') },
            { label: t('namespaces.docs.dashboard'), href: repoDocsUrl('docs/DASHBOARD.md') },
          ]}
        />
      </GuidanceSection>

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label={t('namespaces.metrics.total')} value={counts.total} />
        <MetricCard label={t('namespaces.metrics.withBudget')} value={counts.with_budget} />
        <MetricCard label={t('namespaces.metrics.withRateLimit')} value={counts.with_rate_limit} />
        <MetricCard label={t('namespaces.metrics.boundKeys')} value={counts.bound_api_keys} />
        <MetricCard label={t('namespaces.metrics.boundTeams')} value={counts.bound_teams} />
      </div>

      {(createNamespace.error || updateNamespace.error || deleteNamespace.error) && (
        <ErrorState
          error={createNamespace.error || updateNamespace.error || deleteNamespace.error}
          onRetry={() => {
            createNamespace.reset()
            updateNamespace.reset()
            deleteNamespace.reset()
          }}
        />
      )}

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('namespaces.table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {namespaces.isLoading ? (
            <SkeletonTable rows={4} cols={7} />
          ) : namespaces.data?.namespaces.length === 0 ? (
            <EmptyState
              icon={Layers3}
              title={t('namespaces.empty.title')}
              description={t('namespaces.empty.description')}
              action={
                <PermissionTooltip allowed={canAdmin} requiredRole="admin">
                  <Button onClick={() => setCreateOpen(true)} disabled={!canAdmin}>
                    <Plus className="h-4 w-4" />
                    {t('namespaces.actions.new')}
                  </Button>
                </PermissionTooltip>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('namespaces.table.namespace')}</TableHead>
                  <TableHead>{t('namespaces.table.allowedNodes')}</TableHead>
                  <TableHead>{t('namespaces.table.allowedModels')}</TableHead>
                  <TableHead>{t('namespaces.table.budget')}</TableHead>
                  <TableHead>{t('namespaces.table.rateLimit')}</TableHead>
                  <TableHead>{t('namespaces.table.bindings')}</TableHead>
                  <TableHead>{t('namespaces.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {namespaces.data?.namespaces.map((namespace) => {
                  const unknownNodes = nodeIds
                    ? namespace.allowed_nodes.filter((node) => !nodeIds.has(node))
                    : []
                  return (
                    <TableRow key={namespace.id}>
                      <TableCell>
                        <div className="font-semibold text-[var(--foreground)]">{namespace.name}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-[var(--foreground-dim)]">
                          {namespace.id}
                        </div>
                        {unknownNodes.length > 0 && (
                          <div className="mt-2">
                            <Badge variant="amber">{t('namespaces.validation.unknownNodes')}</Badge>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ResourceList
                          values={namespace.allowed_nodes}
                          fallback={t('namespaces.values.allConfigured')}
                        />
                      </TableCell>
                      <TableCell>
                        <ResourceList
                          values={namespace.allowed_models}
                          fallback={t('namespaces.values.allConfigured')}
                        />
                      </TableCell>
                      <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                        {namespace.budget ? (
                          <div className="space-y-1">
                            <div>{t('namespaces.values.tokens')}: {namespace.budget.daily_token_limit ?? '-'}</div>
                            <div>{t('namespaces.values.cost')}: {namespace.budget.daily_cost_limit ?? '-'}</div>
                          </div>
                        ) : t('namespaces.values.unset')}
                      </TableCell>
                      <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                        {namespace.rate_limit_per_minute
                          ? t('namespaces.values.rpm', { rpm: namespace.rate_limit_per_minute })
                          : t('namespaces.values.unset')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="blue">
                            {t('namespaces.bindings.apiKeys')}: {namespace.bindings.counts.api_keys}
                          </Badge>
                          <Badge variant="purple">
                            {t('namespaces.bindings.teams')}: {namespace.bindings.counts.teams}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <PermissionTooltip allowed={canAdmin} requiredRole="admin">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canAdmin}
                              onClick={() => setEditing(namespace)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t('action.edit')}
                            </Button>
                          </PermissionTooltip>
                          <PermissionTooltip allowed={canAdmin} requiredRole="admin">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!canAdmin || deleteNamespace.isPending}
                              onClick={() => handleDelete(namespace)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('action.delete')}
                            </Button>
                          </PermissionTooltip>
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

      <NamespaceFormDialog
        open={createOpen}
        mode="create"
        initial={emptyForm}
        pending={createNamespace.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(form) => {
          createNamespace.mutate(buildCreatePayload(form), {
            onSuccess: () => setCreateOpen(false),
          })
        }}
      />

      <NamespaceFormDialog
        open={!!editing}
        mode="edit"
        initial={editing ? formFromNamespace(editing) : emptyForm}
        pending={updateNamespace.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(form) => {
          if (!editing) return
          updateNamespace.mutate(
            { id: editing.id, data: buildUpdatePayload(form) },
            { onSuccess: () => setEditing(null) },
          )
        }}
      />

      <ConfirmDeleteDialog
        open={!!deleting}
        namespace={deleting}
        response={deleteImpact}
        pending={deleteNamespace.isPending}
        onClose={() => {
          setDeleting(null)
          setDeleteImpact(null)
        }}
        onConfirm={() => {
          if (!deleting) return
          const confirmImpact = deleting.bindings.counts.total > 0
          deleteNamespace.mutate(
            { id: deleting.id, confirmImpact },
            {
              onSuccess: () => {
                setDeleting(null)
                setDeleteImpact(null)
              },
              onError: (error) => {
                try {
                  const parsed = JSON.parse(error.message) as NamespaceMutationResponse
                  if (parsed.impact) setDeleteImpact(parsed)
                } catch {
                  setDeleteImpact(null)
                }
              },
            },
          )
        }}
      />
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Check,
  Copy,
  Gauge,
  KeyRound,
  Layers3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import { useApiKeys } from '@/hooks/use-api-keys'
import { useNodes } from '@/hooks/use-nodes'
import { useNamespaces } from '@/hooks/use-namespaces'
import {
  useCreateGatewayApiKey,
  useDeleteGatewayApiKey,
  useRotateGatewayApiKey,
  useUpdateGatewayApiKey,
} from '@/hooks/use-mutations'
import { cn, formatCost, formatDate, formatNumber } from '@/lib/utils'
import type {
  CreateGatewayApiKeyRequest,
  GatewayApiKey,
  GatewayApiKeyMutationResponse,
} from '@/types/api'

interface KeyFormState {
  name: string
  description: string
  allow_auto: boolean
  allow_direct: boolean
  allowed_nodes: string[]
  allowed_models: string[]
  allowed_endpoints: string[]
  allowed_modalities: string[]
  namespace_id: string
  daily_token_limit: string
  daily_cost_limit: string
  rate_limit_per_minute: string
}

interface PickerOption {
  value: string
  label: string
  description?: string
}

const API_KEY_ENDPOINTS = [
  'chat_completions',
  'responses',
  'messages',
  'embeddings',
  'rerank',
  'images',
  'audio',
  'video',
  'realtime',
  'mcp',
  'models',
] as const

const API_KEY_MODALITIES = [
  'text',
  'vision',
  'embedding',
  'rerank',
  'image',
  'audio',
  'video',
  'realtime',
] as const

const emptyForm: KeyFormState = {
  name: '',
  description: '',
  allow_auto: true,
  allow_direct: false,
  allowed_nodes: [],
  allowed_models: [],
  allowed_endpoints: [],
  allowed_modalities: [],
  namespace_id: '',
  daily_token_limit: '',
  daily_cost_limit: '',
  rate_limit_per_minute: '',
}

function nodeModelBuckets(node: {
  models?: string[]
  embedding_models?: string[]
  rerank_models?: string[]
  image_models?: string[]
  audio_models?: string[]
  video_models?: string[]
  realtime_models?: string[]
}) {
  return Array.from(new Set([
    ...(node.models || []),
    ...(node.embedding_models || []),
    ...(node.rerank_models || []),
    ...(node.image_models || []),
    ...(node.audio_models || []),
    ...(node.video_models || []),
    ...(node.realtime_models || []),
  ].filter(Boolean)))
}

function pct(value: number) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 1000) / 10}%`
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function buildPayload(form: KeyFormState): CreateGatewayApiKeyRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    allow_auto: form.allow_auto,
    allow_direct: form.allow_direct,
    allowed_nodes: form.allowed_nodes,
    allowed_models: form.allowed_models,
    allowed_endpoints: form.allowed_endpoints,
    allowed_modalities: form.allowed_modalities,
    namespace_id: form.namespace_id || null,
    daily_token_limit: numberOrNull(form.daily_token_limit),
    daily_cost_limit: numberOrNull(form.daily_cost_limit),
    rate_limit_per_minute: numberOrNull(form.rate_limit_per_minute),
  }
}

function formFromKey(key: GatewayApiKey): KeyFormState {
  return {
    name: key.name,
    description: key.description || '',
    allow_auto: key.allow_auto,
    allow_direct: key.allow_direct,
    allowed_nodes: key.allowed_nodes,
    allowed_models: key.allowed_models,
    allowed_endpoints: key.allowed_endpoints,
    allowed_modalities: key.allowed_modalities,
    namespace_id: key.namespace_id || '',
    daily_token_limit: key.daily_token_limit?.toString() || '',
    daily_cost_limit: key.daily_cost_limit?.toString() || '',
    rate_limit_per_minute: key.rate_limit_per_minute?.toString() || '',
  }
}

function MultiResourcePicker({
  label,
  options,
  value,
  allLabel,
  emptyLabel,
  searchPlaceholder,
  onChange,
}: {
  label: string
  options: PickerOption[]
  value: string[]
  allLabel: string
  emptyLabel: string
  searchPlaceholder: string
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation('apiKeys')
  const [query, setQuery] = useState('')
  const selected = new Set(value)
  const selectedOptions = value.map((item) => options.find((opt) => opt.value === item) || {
    value: item,
    label: item,
  })
  const filtered = options.filter((opt) => {
    const haystack = `${opt.label} ${opt.value} ${opt.description || ''}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const toggle = (item: string) => {
    onChange(selected.has(item) ? value.filter((v) => v !== item) : [...value, item])
  }

  const selectVisible = () => {
    onChange(Array.from(new Set([...value, ...filtered.map((opt) => opt.value)])))
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
          {label}
        </label>
        <div className="text-[11px] font-medium text-[var(--foreground-dim)]">
          {value.length === 0 ? allLabel : t('picker.selected', { count: value.length })}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-2 shadow-sm">
        <div className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--foreground-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-dim)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded-md p-1 text-[var(--foreground-dim)] transition-colors hover:bg-[var(--background-tertiary)] hover:text-[var(--foreground)]"
              title={t('picker.clearSearch')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedOptions.length === 0 ? (
            <span className="rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--foreground-dim)]">
              {emptyLabel}
            </span>
          ) : (
            selectedOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] font-medium text-[var(--foreground-muted)] transition-colors hover:border-red-400/40 hover:text-red-500"
                title={t('picker.remove', { value: opt.value })}
              >
                <span className="truncate">{opt.label}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selectVisible}
            disabled={filtered.length === 0}
          >
            {t('picker.selectVisible')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            disabled={value.length === 0}
          >
            {t('actions.clear')}
          </Button>
        </div>

        <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[var(--foreground-dim)]">
              {t('picker.noMatches')}
            </div>
          ) : (
            filtered.map((opt) => {
              const checked = selected.has(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    checked ? 'bg-[var(--accent-muted)]' : 'hover:bg-[var(--background-secondary)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
                        : 'border-[var(--border)] bg-[var(--inset-bg)]',
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[var(--foreground)]">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="block truncate text-[11px] text-[var(--foreground-dim)]">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function CreatedKeyDialog({
  created,
  nodes,
  onClose,
}: {
  created: GatewayApiKeyMutationResponse | null
  nodes: {
    id: string
    name: string
    protocol: string
    models: string[]
  }[]
  onClose: () => void
}) {
  const { t } = useTranslation('apiKeys')
  const [copied, setCopied] = useState(false)
  const plainKey = created?.key || ''
  const key = created?.item
  const allowedNodeSet = new Set(key?.allowed_nodes || [])
  const directModel =
    key?.allowed_models?.[0] ||
    nodes
      .filter((node) => allowedNodeSet.size === 0 || allowedNodeSet.has(node.id))
      .flatMap((node) => node.models)[0] ||
    'gpt-4o'
  const autoCurl = `curl http://localhost:2099/v1/chat/completions \\
  -H "Authorization: Bearer ${plainKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'`
  const directCurl = `curl http://localhost:2099/v1/chat/completions \\
  -H "Authorization: Bearer ${plainKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${directModel}","messages":[{"role":"user","content":"hello"}]}'`

  return (
    <Dialog open={!!created} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('createdDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-[13px] leading-6 text-amber-700 dark:text-amber-300">
            {t('createdDialog.onceWarning')}
          </div>
          <div className="rounded-xl bg-[var(--inset-bg)] p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('createdDialog.authorizationHeader')}
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-[var(--background)] px-3 py-2 font-mono text-[12px] text-[var(--foreground)]">
                Authorization: Bearer {plainKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(plainKey)
                  setCopied(true)
                }}
                title={t('createdDialog.copyKey')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {key?.allow_auto && (
          <div className="rounded-xl bg-[var(--inset-bg)] p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('createdDialog.autoRoutingCurl')}
            </div>
            <code className="block overflow-x-auto whitespace-pre rounded-lg bg-[var(--background)] p-3 font-mono text-[11px] leading-5 text-[var(--foreground-muted)]">
              {autoCurl}
            </code>
          </div>
          )}
          {key?.allow_direct ? (
            <div className="rounded-xl bg-[var(--inset-bg)] p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('createdDialog.directModelCurl')}
              </div>
              <code className="block overflow-x-auto whitespace-pre rounded-lg bg-[var(--background)] p-3 font-mono text-[11px] leading-5 text-[var(--foreground-muted)]">
                {directCurl}
              </code>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-3 text-[12px] leading-5 text-[var(--foreground-dim)]">
              {t('createdDialog.directDisabled')}
            </div>
          )}
          {copied && (
            <div className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
              {t('createdDialog.copied')}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('actions.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KeyFormDialog({
  open,
  mode,
  initial,
  nodes,
  namespaces,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean
  mode: 'create' | 'edit'
  initial: KeyFormState
  nodes: {
    id: string
    name: string
    protocol: string
    models: string[]
  }[]
  namespaces: { id: string; name?: string }[]
  onClose: () => void
  onSubmit: (form: KeyFormState) => void
  pending: boolean
}) {
  const { t } = useTranslation('apiKeys')
  const [form, setForm] = useState<KeyFormState>(initial)
  const nodeOptions = useMemo<PickerOption[]>(
    () =>
      nodes.map((node) => ({
        value: node.id,
        label: node.name || node.id,
        description: t('form.nodeDescription', { id: node.id, protocol: node.protocol, count: node.models.length }),
      })),
    [nodes, t],
  )
  const endpointOptions = useMemo<PickerOption[]>(
    () =>
      API_KEY_ENDPOINTS.map((endpoint) => ({
        value: endpoint,
        label: t(`endpoints.${endpoint}`),
        description: t(`endpointsDescription.${endpoint}`),
      })),
    [t],
  )
  const modalityOptions = useMemo<PickerOption[]>(
    () =>
      API_KEY_MODALITIES.map((modality) => ({
        value: modality,
        label: t(`modalities.${modality}`),
        description: t(`modalitiesDescription.${modality}`),
      })),
    [t],
  )
  const modelOptions = useMemo<PickerOption[]>(() => {
    const allowedNodeSet = new Set(form.allowed_nodes)
    const visibleNodes = allowedNodeSet.size > 0
      ? nodes.filter((node) => allowedNodeSet.has(node.id))
      : nodes
    const byModel = new Map<string, Set<string>>()

    for (const node of visibleNodes) {
      for (const model of node.models) {
        if (!byModel.has(model)) byModel.set(model, new Set())
        byModel.get(model)!.add(node.id)
      }
    }

    return Array.from(byModel.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, nodeIds]) => ({
        value: model,
        label: model,
        description: Array.from(nodeIds).join(', '),
      }))
  }, [nodes, form.allowed_nodes])
  const namespaceOptions = useMemo(
    () => [
      { value: '', label: t('form.noNamespace') },
      ...namespaces.map((namespace) => ({
        value: namespace.id,
        label: namespace.name || namespace.id,
      })),
    ],
    [namespaces, t],
  )
  const visibleModelValues = useMemo(() => new Set(modelOptions.map((opt) => opt.value)), [modelOptions])

  useEffect(() => {
    if (open) setForm(initial)
  }, [open, initial])

  useEffect(() => {
    setForm((prev) => {
      const allowedModels = prev.allowed_models.filter((model) => visibleModelValues.has(model))
      return allowedModels.length === prev.allowed_models.length
        ? prev
        : { ...prev, allowed_models: allowedModels }
    })
  }, [visibleModelValues])

  const canSubmit = form.name.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('form.createTitle') : t('form.editTitle')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('form.name')}
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('form.description')}
            </label>
            <Input
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t('form.descriptionPlaceholder')}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('form.namespace')}
            </label>
            <Select
              options={namespaceOptions}
              value={form.namespace_id}
              onChange={(namespace_id) => setForm((prev) => ({ ...prev, namespace_id }))}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, allow_auto: !prev.allow_auto }))}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                form.allow_auto
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-[var(--border)] bg-[var(--inset-bg)]',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--foreground)]">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                {t('form.autoRouting')}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--foreground-dim)]">
                {t('form.autoRoutingDescription')}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, allow_direct: !prev.allow_direct }))}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                form.allow_direct
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-[var(--border)] bg-[var(--inset-bg)]',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--foreground)]">
                <KeyRound className="h-4 w-4 text-amber-500" />
                {t('form.directRouting')}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--foreground-dim)]">
                {t('form.directRoutingDescription')}
              </div>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MultiResourcePicker
              label={t('form.allowedUpstreams')}
              options={nodeOptions}
              value={form.allowed_nodes}
              allLabel={t('form.allUpstreams')}
              emptyLabel={t('form.allConfiguredUpstreams')}
              searchPlaceholder={t('form.searchUpstreams')}
              onChange={(allowed_nodes) =>
                setForm((prev) => ({
                  ...prev,
                  allowed_nodes,
                  allowed_models: prev.allowed_models.filter((model) => {
                    if (allowed_nodes.length === 0) return true
                    return nodes
                      .filter((node) => allowed_nodes.includes(node.id))
                      .some((node) => node.models.includes(model))
                  }),
                }))
              }
            />
            <MultiResourcePicker
              label={t('form.allowedModels')}
              options={modelOptions}
              value={form.allowed_models}
              allLabel={t('form.allModels')}
              emptyLabel={t('form.allModelsInAllowedUpstreams')}
              searchPlaceholder={t('form.searchModels')}
              onChange={(allowed_models) => setForm((prev) => ({ ...prev, allowed_models }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MultiResourcePicker
              label={t('form.allowedEndpoints')}
              options={endpointOptions}
              value={form.allowed_endpoints}
              allLabel={t('form.allEndpoints')}
              emptyLabel={t('form.allGatewayEndpoints')}
              searchPlaceholder={t('form.searchEndpoints')}
              onChange={(allowed_endpoints) => setForm((prev) => ({ ...prev, allowed_endpoints }))}
            />
            <MultiResourcePicker
              label={t('form.allowedModalities')}
              options={modalityOptions}
              value={form.allowed_modalities}
              allLabel={t('form.allModalities')}
              emptyLabel={t('form.allGatewayModalities')}
              searchPlaceholder={t('form.searchModalities')}
              onChange={(allowed_modalities) => setForm((prev) => ({ ...prev, allowed_modalities }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('form.dailyTokens')}
              </label>
              <Input
                type="number"
                min="0"
                value={form.daily_token_limit}
                onChange={(e) => setForm((prev) => ({ ...prev, daily_token_limit: e.target.value }))}
                placeholder={t('form.unlimited')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('form.dailyCost')}
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.daily_cost_limit}
                onChange={(e) => setForm((prev) => ({ ...prev, daily_cost_limit: e.target.value }))}
                placeholder={t('form.unlimited')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {t('form.rpm')}
              </label>
              <Input
                type="number"
                min="0"
                value={form.rate_limit_per_minute}
                onChange={(e) => setForm((prev) => ({ ...prev, rate_limit_per_minute: e.target.value }))}
                placeholder={t('form.global')}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button disabled={!canSubmit || pending} onClick={() => onSubmit(form)}>
            {mode === 'create' ? t('actions.createKey') : t('actions.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ApiKeysPage() {
  const { t } = useTranslation('apiKeys')
  const { data, isLoading, isError, error, refetch } = useApiKeys()
  const { data: nodesData } = useNodes()
  const { data: namespacesData } = useNamespaces()
  const createKey = useCreateGatewayApiKey()
  const updateKey = useUpdateGatewayApiKey()
  const rotateKey = useRotateGatewayApiKey()
  const deleteKey = useDeleteGatewayApiKey()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<GatewayApiKey | null>(null)
  const [created, setCreated] = useState<GatewayApiKeyMutationResponse | null>(null)

  const keys = data?.items || []
  const nodes = useMemo(
    () => (nodesData?.nodes || []).map((node) => ({
      ...node,
      models: nodeModelBuckets(node),
    })),
    [nodesData?.nodes],
  )
  const namespaces = namespacesData?.namespaces || []

  const totals = keys.reduce(
    (acc, key) => ({
      calls: acc.calls + key.today.calls,
      errors: acc.errors + key.today.errors,
      cost: acc.cost + key.today.cost_usd,
      active: acc.active + (key.status === 'active' ? 1 : 0),
    }),
    { calls: 0, errors: 0, cost: 0, active: 0 },
  )
  const errorRate = totals.calls > 0 ? totals.errors / totals.calls : 0

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
        icon={KeyRound}
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('actions.newKey')}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('summary.activeKeys')}
            </div>
            <div className="mt-2 text-3xl font-bold text-[var(--foreground)]">{totals.active}</div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('summary.callsToday')}
            </div>
            <div className="mt-2 text-3xl font-bold text-[var(--foreground)]">{formatNumber(totals.calls)}</div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              {t('summary.costToday')}
            </div>
            <div className="mt-2 text-3xl font-bold text-[var(--foreground)]">{formatCost(totals.cost)}</div>
          </CardContent>
        </CardStatic>
        <CardStatic>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
              <Activity className="h-3.5 w-3.5" />
              {t('summary.errorRate')}
            </div>
            <div className="mt-2 text-3xl font-bold text-[var(--foreground)]">{pct(errorRate)}</div>
          </CardContent>
        </CardStatic>
      </div>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={5} cols={7} />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t('actions.createKey')}
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead>{t('table.key')}</TableHead>
                  <TableHead>{t('table.permissions')}</TableHead>
                  <TableHead className="text-right">{t('table.today')}</TableHead>
                  <TableHead>{t('table.lastUsed')}</TableHead>
                  <TableHead>{t('table.status')}</TableHead>
                  <TableHead className="text-right">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="font-medium text-[var(--foreground)]">{key.name}</div>
                      {key.description && (
                        <div className="mt-0.5 text-[11px] text-[var(--foreground-dim)]">{key.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      <div>{key.key_prefix}</div>
                      <div className="mt-0.5 font-sans text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                        {t('table.masked')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[360px] flex-wrap gap-1.5">
                        {key.allow_auto ? <Badge variant="emerald">{t('permissions.auto')}</Badge> : <Badge variant="zinc">{t('permissions.noAuto')}</Badge>}
                        {key.allow_direct ? <Badge variant="amber">{t('permissions.direct')}</Badge> : <Badge variant="zinc">{t('permissions.noDirect')}</Badge>}
                        {key.namespace_id && <Badge variant="blue">{key.namespace_name || key.namespace_id}</Badge>}
                        {key.allowed_nodes.length > 0 && <Badge variant="blue">{t('permissions.upstreams', { count: key.allowed_nodes.length })}</Badge>}
                        {key.allowed_models.length > 0 && <Badge variant="purple">{t('permissions.models', { count: key.allowed_models.length })}</Badge>}
                        {key.allowed_endpoints.length > 0 && <Badge variant="zinc">{t('permissions.endpoints', { count: key.allowed_endpoints.length })}</Badge>}
                        {key.allowed_modalities.length > 0 && <Badge variant="zinc">{t('permissions.modalities', { count: key.allowed_modalities.length })}</Badge>}
                      </div>
                      <div className="mt-2 grid gap-1 text-[10px] text-[var(--foreground-dim)]">
                        <span className="inline-flex items-center gap-1">
                          <Layers3 className="h-3 w-3" />
                          {key.allowed_endpoints.length > 0
                            ? key.allowed_endpoints.map((item) => t(`endpoints.${item}`, { defaultValue: item })).join(', ')
                            : t('permissions.allEndpoints')}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Gauge className="h-3 w-3" />
                          {key.daily_token_limit || key.daily_cost_limit || key.rate_limit_per_minute
                            ? [
                                key.daily_token_limit ? t('limits.tokens', { value: formatNumber(key.daily_token_limit) }) : null,
                                key.daily_cost_limit ? t('limits.cost', { value: formatCost(key.daily_cost_limit) }) : null,
                                key.rate_limit_per_minute ? t('limits.rpm', { value: formatNumber(key.rate_limit_per_minute) }) : null,
                              ].filter(Boolean).join(' · ')
                            : t('limits.inherited')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono text-[11px] text-[var(--foreground)]">{formatCost(key.today.cost_usd)}</div>
                      <div className="font-mono text-[10px] text-[var(--foreground-dim)]">
                        {t('table.calls', { count: formatNumber(key.today.calls) })}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--foreground-dim)]">
                        {t('table.errorRate', { rate: pct(key.today.error_rate) })}
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {key.last_used_at ? formatDate(key.last_used_at) : t('table.never')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.status === 'active' ? 'emerald' : 'zinc'}>
                        {t(`status.${key.status}`, { defaultValue: key.status })}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditing(key)} title={t('actions.editKey')}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={key.status === 'active' ? t('actions.disableKey') : t('actions.enableKey')}
                          onClick={() =>
                            updateKey.mutate({
                              id: key.id,
                              data: { status: key.status === 'active' ? 'disabled' : 'active' },
                            })
                          }
                        >
                          {key.status === 'active' ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('actions.rotateKey')}
                          onClick={() => rotateKey.mutate(key.id, { onSuccess: setCreated })}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('actions.deleteKey')}
                          onClick={() => {
                            if (confirm(t('confirm.deleteKey', { name: key.name }))) {
                              deleteKey.mutate(key.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </CardStatic>

      <KeyFormDialog
        open={createOpen}
        mode="create"
        initial={emptyForm}
        nodes={nodes}
        namespaces={namespaces}
        pending={createKey.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(form) => {
          createKey.mutate(buildPayload(form), {
            onSuccess: (result) => {
              setCreateOpen(false)
              setCreated(result)
            },
          })
        }}
      />

      <KeyFormDialog
        open={!!editing}
        mode="edit"
        initial={editing ? formFromKey(editing) : emptyForm}
        nodes={nodes}
        namespaces={namespaces}
        pending={updateKey.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(form) => {
          if (!editing) return
          updateKey.mutate(
            { id: editing.id, data: buildPayload(form) },
            { onSuccess: () => setEditing(null) },
          )
        }}
      />

      <CreatedKeyDialog created={created} nodes={nodes} onClose={() => setCreated(null)} />
    </div>
  )
}

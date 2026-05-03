import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2, ArrowLeft, Settings2, Zap, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { CapabilityPicker } from '@/components/shared/CapabilityPicker'
import { TierRecommendation } from '@/components/shared/TierRecommendation'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useTestNode, useTestExistingNode } from '@/hooks/use-mutations'
import { useProviderCatalogProviders } from '@/hooks/use-provider-catalog'
import type {
  CatalogModel,
  CatalogProvider,
  NodeInfo,
  CreateNodeRequest,
  UpdateNodeRequest,
  TestNodeResponse,
} from '@/types/api'

// Default endpoints per protocol — the canonical paths
const PROTOCOL_ENDPOINTS: Record<string, string> = {
  chat_completions: '/v1/chat/completions',
  responses: '/v1/responses',
  messages: '/v1/messages',
}

// ── Provider Presets ─────────────────────────────────────

interface ProviderPreset {
  id: string
  name: string
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  auth_type?: 'bearer' | 'x-api-key'
  models: string[]
  model_prefixes?: string[]
  capabilities: string[]
  tags: string[]
  keyPlaceholder: string
}

function providerToPreset(provider: CatalogProvider): ProviderPreset {
  const protocol = provider.default_protocol || provider.protocols[0] || 'chat_completions'
  const textModels = provider.models
    .filter((model) => isTextModelForProtocol(model, protocol))
    .map((model) => model.id)
  const fallbackModels = provider.models
    .filter((model) => !model.modalities.includes('embedding') && !model.modalities.includes('rerank'))
    .map((model) => model.id)

  const models = unique(textModels.length > 0 ? textModels : fallbackModels).slice(0, 8)

  return {
    id: provider.id,
    name: provider.name,
    protocol,
    base_url: provider.base_url,
    endpoint: provider.endpoints[protocol] || PROTOCOL_ENDPOINTS[protocol] || '/v1/chat/completions',
    auth_type:
      provider.auth_type === 'bearer' || provider.auth_type === 'x-api-key'
        ? provider.auth_type
        : undefined,
    models: models.length > 0 ? models : [''],
    model_prefixes: provider.model_prefixes,
    capabilities: unique(provider.capabilities.filter((capability) => capability !== 'custom')),
    tags: provider.tags || [],
    keyPlaceholder: provider.key_placeholder || 'provider key...',
  }
}

function isTextModelForProtocol(
  model: CatalogModel,
  protocol: ProviderPreset['protocol'],
): boolean {
  return (
    model.endpoints.includes(protocol) &&
    (model.modalities.includes('text') || model.modalities.includes('vision'))
  )
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

// ── Types ────────────────────────────────────────────────

interface NodeFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateNodeRequest | UpdateNodeRequest) => void
  isPending: boolean
  editNode?: NodeInfo | null
  existingIds: string[]
  existingNodes: NodeInfo[]
}

interface FormState {
  id: string
  name: string
  protocol: string
  base_url: string
  endpoint: string
  api_key: string
  timeout_ms: string
  models: string[]
  model_prefixes: string[]
  capabilities: string[]
  tags: string[]
  aliases: { key: string; value: string }[]
  auth_type: string
}

const EMPTY_FORM: FormState = {
  id: '',
  name: '',
  protocol: 'chat_completions',
  base_url: '',
  endpoint: '/v1/chat/completions',
  api_key: '',
  timeout_ms: '30000',
  models: [''],
  model_prefixes: [],
  capabilities: [],
  tags: [],
  aliases: [],
  auth_type: '',
}

// ── Main Component ───────────────────────────────────────

export function NodeFormModal({
  open,
  onClose,
  onSubmit,
  isPending,
  editNode,
  existingIds,
  existingNodes,
}: NodeFormModalProps) {
  const { t } = useTranslation('nodes')
  const isEdit = !!editNode
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestNodeResponse | null>(null)
  const [useCustomEndpoint, setUseCustomEndpoint] = useState(false)
  const testNode = useTestNode()
  const testExisting = useTestExistingNode()
  const providerCatalog = useProviderCatalogProviders(open && !isEdit)
  const providerPresets = useMemo(
    () => (providerCatalog.data?.providers || []).map(providerToPreset),
    [providerCatalog.data],
  )

  // Reset when modal opens
  useEffect(() => {
    if (!open) return
    setTestResult(null)
    setPrefixInput('')
    setTagInput('')
    setUseCustomEndpoint(false)
    if (editNode) {
      setStep('form')
      setSelectedPreset(null)
      const defaultEp = PROTOCOL_ENDPOINTS[editNode.protocol] || ''
      const isCustomEp = editNode.endpoint !== defaultEp
      setUseCustomEndpoint(isCustomEp)
      setForm({
        id: editNode.id,
        name: editNode.name,
        protocol: editNode.protocol,
        base_url: editNode.base_url,
        endpoint: editNode.endpoint,
        api_key: '',
        timeout_ms: '30000',
        models: editNode.models.length > 0 ? editNode.models : [''],
        model_prefixes: editNode.model_prefixes || [],
        capabilities: editNode.capabilities || [],
        tags: editNode.tags || [],
        aliases: Object.entries(editNode.aliases || {}).map(([key, value]) => ({ key, value })),
        auth_type: '',
      })
    } else {
      setStep('pick')
      setSelectedPreset(null)
      setForm(EMPTY_FORM)
    }
    setErrors({})
  }, [open, editNode])

  const pickPreset = (preset: ProviderPreset) => {
    let candidateId = preset.id
    let suffix = 2
    while (existingIds.includes(candidateId)) {
      candidateId = `${preset.id}-${suffix}`
      suffix++
    }

    setForm({
      id: candidateId,
      name: preset.name,
      protocol: preset.protocol,
      base_url: preset.base_url,
      endpoint: preset.endpoint,
      api_key: '',
      timeout_ms: '30000',
      models: [...preset.models],
      model_prefixes: [...(preset.model_prefixes || [])],
      capabilities: [...preset.capabilities],
      tags: [...preset.tags],
      aliases: [],
      auth_type: preset.auth_type || '',
    })
    setSelectedPreset(preset.id)
    const defaultEp = PROTOCOL_ENDPOINTS[preset.protocol] || ''
    setUseCustomEndpoint(preset.endpoint !== defaultEp)
    setErrors({})
    setStep('form')
  }

  const pickCustom = () => {
    setForm(EMPTY_FORM)
    setSelectedPreset(null)
    setUseCustomEndpoint(false)
    setErrors({})
    setStep('form')
  }

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    },
    [],
  )

  // Model list
  const addModel = () => setField('models', [...form.models, ''])
  const removeModel = (idx: number) =>
    setField('models', form.models.filter((_, i) => i !== idx))
  const updateModel = (idx: number, value: string) =>
    setField('models', form.models.map((m, i) => (i === idx ? value : m)))

  // Model prefixes
  const [prefixInput, setPrefixInput] = useState('')
  const addPrefix = () => {
    const prefix = prefixInput.trim()
    if (prefix && !form.model_prefixes.includes(prefix)) {
      setField('model_prefixes', [...form.model_prefixes, prefix])
    }
    setPrefixInput('')
  }
  const removePrefix = (prefix: string) =>
    setField('model_prefixes', form.model_prefixes.filter((p) => p !== prefix))

  // Tags
  const [tagInput, setTagInput] = useState('')
  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags.includes(tag)) {
      setField('tags', [...form.tags, tag])
    }
    setTagInput('')
  }
  const removeTag = (tag: string) =>
    setField('tags', form.tags.filter((t) => t !== tag))

  // Aliases
  const addAlias = () =>
    setField('aliases', [...form.aliases, { key: '', value: '' }])
  const removeAlias = (idx: number) =>
    setField('aliases', form.aliases.filter((_, i) => i !== idx))
  const updateAlias = (idx: number, field: 'key' | 'value', val: string) =>
    setField('aliases', form.aliases.map((a, i) => (i === idx ? { ...a, [field]: val } : a)))

  // Test Connection
  const handleTestConnection = () => {
    setTestResult(null)
    const onResult = (result: TestNodeResponse) => setTestResult(result)
    const onFail = (err: Error) =>
      setTestResult({
        success: false,
        status: 0,
        latency_ms: 0,
        message: err.message || t('form.errors.requestFailed'),
      })

    if (isEdit && !form.api_key.trim()) {
      testExisting.mutate(editNode!.id, {
        onSuccess: onResult,
        onError: onFail,
      })
      return
    }

    const errs: Record<string, string> = {}
    if (!form.base_url.trim()) errs.base_url = t('form.errors.requiredForTest')
    if (!form.endpoint.trim()) errs.endpoint = t('form.errors.requiredForTest')
    if (!form.api_key.trim()) errs.api_key = t('form.errors.requiredForTest')
    const firstModel = form.models.find((m) => m.trim())
    if (!firstModel) errs.models = t('form.errors.needModelForTest')

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    testNode.mutate(
      {
        protocol: form.protocol as 'chat_completions' | 'responses' | 'messages',
        base_url: form.base_url.trim(),
        endpoint: form.endpoint.trim(),
        api_key: form.api_key.trim(),
        model: firstModel!.trim(),
        auth_type: form.auth_type ? (form.auth_type as 'bearer' | 'x-api-key') : undefined,
      },
      {
        onSuccess: onResult,
        onError: onFail,
      },
    )
  }

  const isTestPending = testNode.isPending || testExisting.isPending

  // Validation
  const validate = (): boolean => {
    const errs: Record<string, string> = {}

    if (!isEdit) {
      if (!form.id.trim()) errs.id = t('form.errors.idRequired')
      else if (!/^[a-z0-9_-]+$/i.test(form.id.trim()))
        errs.id = t('form.errors.idFormat')
      else if (existingIds.includes(form.id.trim()))
        errs.id = t('form.errors.idExists')

      if (!form.api_key.trim()) errs.api_key = t('form.errors.apiKeyRequired')
      if (!form.endpoint.trim()) errs.endpoint = t('form.errors.endpointRequired')
    }

    if (!form.name.trim()) errs.name = t('form.errors.nameRequired')
    if (!form.base_url.trim()) errs.base_url = t('form.errors.baseUrlRequired')

    const validModels = form.models.filter((m) => m.trim())
    if (validModels.length === 0) errs.models = t('form.errors.modelRequired')
    else if (new Set(validModels.map((m) => m.trim())).size !== validModels.length)
      errs.models = t('form.errors.modelsUnique')

    const validPrefixes = form.model_prefixes.filter((p) => p.trim())
    if (new Set(validPrefixes.map((p) => p.trim())).size !== validPrefixes.length) {
      errs.model_prefixes = t('form.errors.prefixesUnique')
    }

    const validAliases = form.aliases.map((a) => a.key.trim()).filter(Boolean)
    if (new Set(validAliases).size !== validAliases.length) {
      errs.aliases = t('form.errors.aliasesUnique')
    }

    const timeout = Number(form.timeout_ms)
    if (isNaN(timeout) || timeout < 1) errs.timeout_ms = t('form.errors.positiveNumber')

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // Submit
  const handleSubmit = () => {
    if (!validate()) return

    const models = form.models.filter((m) => m.trim())
    const aliasMap: Record<string, string> = {}
    for (const a of form.aliases) {
      if (a.key.trim() && a.value.trim()) {
        aliasMap[a.key.trim()] = a.value.trim()
      }
    }

    if (isEdit) {
      const modelPrefixes = form.model_prefixes.map((p) => p.trim()).filter(Boolean)
      const data: UpdateNodeRequest = {
        name: form.name.trim(),
        protocol: form.protocol as CreateNodeRequest['protocol'],
        base_url: form.base_url.trim(),
        models,
        timeout_ms: Number(form.timeout_ms),
        capabilities: form.capabilities.length > 0 ? form.capabilities : undefined,
        tags: form.tags,
        model_aliases: aliasMap,
        model_prefixes: modelPrefixes,
      }
      if (form.api_key.trim()) data.api_key = form.api_key.trim()
      if (form.endpoint.trim()) data.endpoint = form.endpoint.trim()
      if (form.auth_type) data.auth_type = form.auth_type as 'bearer' | 'x-api-key'
      onSubmit(data)
    } else {
      const modelPrefixes = form.model_prefixes.map((p) => p.trim()).filter(Boolean)
      const data: CreateNodeRequest = {
        id: form.id.trim(),
        name: form.name.trim(),
        protocol: form.protocol as CreateNodeRequest['protocol'],
        base_url: form.base_url.trim(),
        endpoint: form.endpoint.trim(),
        api_key: form.api_key.trim(),
        models,
        timeout_ms: Number(form.timeout_ms),
        capabilities: form.capabilities.length > 0 ? form.capabilities : undefined,
        tags: form.tags.length > 0 ? form.tags : undefined,
        model_aliases: Object.keys(aliasMap).length > 0 ? aliasMap : undefined,
        model_prefixes: modelPrefixes.length > 0 ? modelPrefixes : undefined,
        auth_type: form.auth_type ? (form.auth_type as 'bearer' | 'x-api-key') : undefined,
      }
      onSubmit(data)
    }
  }

  const presetInfo = selectedPreset
    ? providerPresets.find((p) => p.id === selectedPreset)
    : null
  const currentNodeId = isEdit ? editNode!.id : form.id.trim()
  const otherNodes = existingNodes.filter((node) => node.id !== currentNodeId)
  const allNodeIds = existingNodes.map((node) => node.id)
  const allModelOwners = existingNodes.flatMap((node) =>
    node.models.map((model) => ({ model, nodeId: node.id })),
  )
  const otherModelOwners = allModelOwners.filter((owner) => owner.nodeId !== currentNodeId)
  const otherAliasOwners = otherNodes.flatMap((node) =>
    Object.keys(node.aliases || {}).map((alias) => ({ alias, nodeId: node.id })),
  )
  const otherPrefixOwners = otherNodes.flatMap((node) =>
    (node.model_prefixes || []).map((prefix) => ({ prefix, nodeId: node.id })),
  )
  const trimmedModels = form.models.map((model) => model.trim()).filter(Boolean)
  const trimmedPrefixes = form.model_prefixes.map((prefix) => prefix.trim()).filter(Boolean)
  const trimmedAliases = form.aliases
    .map((alias) => ({ key: alias.key.trim(), value: alias.value.trim() }))
    .filter((alias) => alias.key || alias.value)
  const namingWarnings = [
    ...(!isEdit && form.id.trim() && allModelOwners.some((owner) => owner.model === form.id.trim())
      ? [t('form.warnings.upstreamIdMatchesModel', { id: form.id.trim() })]
      : []),
    ...trimmedModels
      .filter((model) => otherModelOwners.some((owner) => owner.model === model))
      .map((model) => {
        const owners = otherModelOwners.filter((owner) => owner.model === model).map((owner) => owner.nodeId)
        return t('form.warnings.modelAlreadyListed', { model, owners: owners.join(', ') })
      }),
    ...trimmedAliases
      .filter((alias) => alias.key && allModelOwners.some((owner) => owner.model === alias.key))
      .map((alias) => t('form.warnings.aliasMatchesModel', { alias: alias.key })),
    ...trimmedAliases
      .filter((alias) => alias.key && allNodeIds.includes(alias.key))
      .map((alias) => t('form.warnings.aliasMatchesUpstream', { alias: alias.key })),
    ...trimmedAliases
      .filter((alias) => alias.key && otherAliasOwners.some((owner) => owner.alias === alias.key))
      .map((alias) => {
        const owners = otherAliasOwners.filter((owner) => owner.alias === alias.key).map((owner) => owner.nodeId)
        return t('form.warnings.aliasAlreadyDefined', { alias: alias.key, owners: owners.join(', ') })
      }),
    ...trimmedAliases
      .filter((alias) => alias.key && alias.value && !trimmedModels.includes(alias.value))
      .map((alias) => t('form.warnings.aliasTargetMissing', { alias: alias.key, target: alias.value })),
    ...trimmedPrefixes
      .filter((prefix) => otherPrefixOwners.some((owner) => owner.prefix === prefix))
      .map((prefix) => {
        const owners = otherPrefixOwners.filter((owner) => owner.prefix === prefix).map((owner) => owner.nodeId)
        return t('form.warnings.prefixAlreadyConfigured', { prefix, owners: owners.join(', ') })
      }),
  ].filter((warning, idx, arr) => arr.indexOf(warning) === idx)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        {/* ─── Step 1: Provider Picker ─── */}
        {step === 'pick' && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
                {t('form.providerPickerTitle')}
              </h2>
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {providerCatalog.isLoading && (
                <div className="flex min-h-28 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--glass-bg)]">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--foreground-dim)]" />
                </div>
              )}

              {providerPresets.map((preset) => {
                const alreadyExists = existingIds.includes(preset.id)
                return (
                  <button
                    key={preset.id}
                    onClick={() => pickPreset(preset)}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--glass-bg)] px-3 py-4 transition-all duration-200 hover:border-[var(--accent)] hover:bg-[var(--inset-bg)] hover:shadow-[0_0_20px_var(--accent-glow)]"
                  >
                    <NodeIcon
                      nodeId={preset.id}
                      protocol={preset.protocol}
                      className="h-7 w-7"
                    />
                    <span className="text-xs font-semibold text-[var(--foreground)]">
                      {preset.name}
                    </span>
                    {alreadyExists && (
                      <span className="text-[9px] text-[var(--foreground-dim)]">
                        {t('form.addAnother')}
                      </span>
                    )}
                  </button>
                )
              })}

              {/* Custom */}
              <button
                onClick={pickCustom}
                className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--glass-bg)] px-3 py-4 transition-all duration-200 hover:border-[var(--accent)] hover:bg-[var(--inset-bg)]"
              >
                <Settings2 className="h-7 w-7 text-[var(--foreground-dim)]" />
                <span className="text-xs font-semibold text-[var(--foreground-muted)]">
                  {t('form.custom')}
                </span>
              </button>
            </div>
          </>
        )}

        {/* ─── Step 2: Form ─── */}
        {step === 'form' && (
          <>
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isEdit && (
                  <button
                    onClick={() => setStep('pick')}
                    className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
                    title={t('form.backToProviderList')}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
                  {isEdit
                    ? t('form.editTitle', { name: editNode!.name })
                    : presetInfo
                      ? t('form.addProviderTitle', { name: presetInfo.name })
                      : t('form.addCustomTitle')}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* ID (create only) */}
              {!isEdit && (
                <FieldGroup label={t('form.labels.upstreamId')} error={errors.id}>
                  <Input
                    value={form.id}
                    onChange={(e) => setField('id', e.target.value)}
                    placeholder={t('form.placeholders.upstreamId')}
                  />
                </FieldGroup>
              )}

              {/* Name */}
              <FieldGroup label={t('form.labels.displayName')} error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder={t('form.placeholders.displayName')}
                />
              </FieldGroup>

              {/* API Key */}
              <FieldGroup
                label={isEdit ? t('form.labels.apiKeyEdit') : t('form.labels.apiKey')}
                error={errors.api_key}
              >
                <Input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setField('api_key', e.target.value)}
                  placeholder={
                    isEdit
                      ? t('form.placeholders.keepExistingKey')
                      : presetInfo?.keyPlaceholder ?? t('form.placeholders.apiKey')
                  }
                />
              </FieldGroup>

              {/* Protocol + Auth Type */}
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label={t('form.labels.protocol')}>
                  <NativeSelect
                    value={form.protocol}
                    onChange={(e) => {
                      const proto = e.target.value
                      setField('protocol', proto)
                      if (!useCustomEndpoint) {
                        setField('endpoint', PROTOCOL_ENDPOINTS[proto] || '')
                      }
                    }}
                    options={[
                      { value: 'chat_completions', label: t('form.protocol.chatCompletions') },
                      { value: 'responses', label: t('form.protocol.responses') },
                      { value: 'messages', label: t('form.protocol.messages') },
                    ]}
                  />
                </FieldGroup>
                <FieldGroup label={t('form.labels.authType')}>
                  <NativeSelect
                    value={form.auth_type}
                    onChange={(e) => setField('auth_type', e.target.value)}
                    options={[
                      { value: '', label: t('form.auth.auto') },
                      { value: 'bearer', label: t('form.auth.bearer') },
                      { value: 'x-api-key', label: t('form.auth.xApiKey') },
                    ]}
                  />
                </FieldGroup>
              </div>

              {/* Base URL + Endpoint */}
              <FieldGroup label={t('form.labels.baseUrl')} error={errors.base_url}>
                <Input
                  value={form.base_url}
                  onChange={(e) => setField('base_url', e.target.value)}
                  placeholder={t('form.placeholders.baseUrl')}
                />
              </FieldGroup>

              <FieldGroup
                label={t('form.labels.endpoint')}
                error={errors.endpoint}
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={form.endpoint}
                    onChange={(e) => setField('endpoint', e.target.value)}
                    disabled={!useCustomEndpoint}
                    className={!useCustomEndpoint ? 'opacity-50' : ''}
                  />
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] font-medium text-[var(--foreground-dim)]">
                    <input
                      type="checkbox"
                      checked={useCustomEndpoint}
                      onChange={(e) => {
                        setUseCustomEndpoint(e.target.checked)
                        if (!e.target.checked) {
                          setField('endpoint', PROTOCOL_ENDPOINTS[form.protocol] || '')
                        }
                      }}
                      className="rounded"
                    />
                    {t('form.labels.customEndpoint')}
                  </label>
                </div>
              </FieldGroup>

              {/* Timeout */}
              <FieldGroup label={t('form.labels.timeout')} error={errors.timeout_ms}>
                <Input
                  type="number"
                  value={form.timeout_ms}
                  onChange={(e) => setField('timeout_ms', e.target.value)}
                  min={1}
                />
              </FieldGroup>

              {/* Models */}
              <FieldGroup label={t('form.labels.models')} error={errors.models}>
                <div className="space-y-2">
                  {form.models.map((model, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={model}
                        onChange={(e) => updateModel(idx, e.target.value)}
                        placeholder={t('form.placeholders.model')}
                        className="flex-1"
                      />
                      {form.models.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeModel(idx)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addModel} type="button">
                    <Plus className="h-3.5 w-3.5" />
                    {t('form.actions.addModel')}
                  </Button>
                </div>
              </FieldGroup>

              {/* Model prefixes */}
              <FieldGroup label={t('form.labels.modelPrefixes')} error={errors.model_prefixes}>
                <div className="space-y-2">
                  <p className="text-[11px] leading-5 text-[var(--foreground-dim)]">
                    {t('form.help.modelPrefixes')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.model_prefixes.map((prefix) => (
                      <span
                        key={prefix}
                        className="inline-flex items-center gap-1 rounded-lg bg-[var(--inset-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground-muted)]"
                      >
                        {prefix}-*
                        <button
                          onClick={() => removePrefix(prefix)}
                          className="text-[var(--foreground-dim)] transition-colors hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={prefixInput}
                      onChange={(e) => setPrefixInput(e.target.value)}
                      placeholder={t('form.placeholders.prefix')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addPrefix()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={addPrefix} type="button">
                      {t('form.actions.add')}
                    </Button>
                  </div>
                </div>
              </FieldGroup>

              {/* Capabilities */}
              <FieldGroup label={t('form.labels.capabilities')}>
                <CapabilityPicker
                  selected={form.capabilities}
                  onChange={(caps) => setField('capabilities', caps)}
                />
              </FieldGroup>

              {/* Tier Recommendation */}
              {form.capabilities.length > 0 && (
                <TierRecommendation capabilities={form.capabilities} />
              )}

              {/* Tags (custom, optional) */}
              <FieldGroup label={t('form.labels.customTags')}>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-lg bg-[var(--inset-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground-muted)]"
                      >
                        {tag}
                        <button
                          onClick={() => removeTag(tag)}
                          className="text-[var(--foreground-dim)] hover:text-red-500 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder={t('form.placeholders.tag')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={addTag} type="button">
                      {t('form.actions.add')}
                    </Button>
                  </div>
                </div>
              </FieldGroup>

              {/* Aliases */}
              <FieldGroup label={t('form.labels.modelAliases')} error={errors.aliases}>
                <div className="space-y-2">
                  <p className="text-[11px] leading-5 text-[var(--foreground-dim)]">
                    {t('form.help.modelAliases')}
                  </p>
                  {form.aliases.map((alias, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={alias.key}
                        onChange={(e) => updateAlias(idx, 'key', e.target.value)}
                        placeholder={t('form.placeholders.alias')}
                        className="flex-1"
                      />
                      <span className="flex items-center text-[var(--foreground-dim)]">&rarr;</span>
                      <Input
                        value={alias.value}
                        onChange={(e) => updateAlias(idx, 'value', e.target.value)}
                        placeholder={t('form.placeholders.modelId')}
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeAlias(idx)} type="button">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addAlias} type="button">
                    <Plus className="h-3.5 w-3.5" />
                    {t('form.actions.addAlias')}
                  </Button>
                </div>
              </FieldGroup>

              {namingWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-amber-800 dark:text-amber-300">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold">
                        {t('form.warnings.title')}
                      </div>
                      <div className="mt-1 space-y-1">
                        {namingWarnings.map((warning) => (
                          <p key={warning} className="text-[11px] leading-5">
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Test Connection + Result */}
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
                    {t('form.connectivity.title')}
                  </span>
                  {isEdit && !form.api_key.trim() && (
                    <span className="ml-2 text-[10px] text-[var(--foreground-dim)]">
                      {t('form.connectivity.usingSavedConfig')}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={isTestPending}
                >
                  {isTestPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {isTestPending ? t('form.connectivity.testing') : t('form.connectivity.testConnection')}
                </Button>
              </div>

              {testResult && (
                <div
                  className={`mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs ${
                    testResult.success
                      ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-400'
                      : 'bg-red-500/8 text-red-700 dark:text-red-400'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <div>
                    <div className="font-semibold">{testResult.message}</div>
                    {testResult.latency_ms > 0 && (
                      <div className="mt-0.5 font-mono opacity-70">
                        HTTP {testResult.status} &middot; {testResult.latency_ms}ms
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                {t('actions.cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending
                  ? isEdit ? t('actions.saving') : t('actions.creating')
                  : isEdit ? t('actions.saveChanges') : t('actions.createUpstream')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Helper: Field wrapper ──

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--foreground-dim)]">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] font-medium text-red-500">{error}</p>}
    </div>
  )
}

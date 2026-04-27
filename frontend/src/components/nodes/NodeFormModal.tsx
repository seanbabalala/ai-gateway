import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, ArrowLeft, Settings2, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { CapabilityPicker } from '@/components/shared/CapabilityPicker'
import { TierRecommendation } from '@/components/shared/TierRecommendation'
import { useTestNode, useTestExistingNode } from '@/hooks/use-mutations'
import type { NodeInfo, CreateNodeRequest, UpdateNodeRequest, TestNodeResponse } from '@/types/api'

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
  capabilities: string[]
  tags: string[]
  keyPlaceholder: string
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'gpt',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    capabilities: ['coding', 'reasoning', 'tool_use'],
    tags: ['code', 'reasoning'],
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'gpt-responses',
    name: 'OpenAI (Responses API)',
    protocol: 'responses',
    base_url: 'https://api.openai.com',
    endpoint: '/v1/responses',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
    capabilities: ['coding', 'reasoning', 'tool_use'],
    tags: ['code', 'reasoning'],
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'claude',
    name: 'Anthropic (Claude)',
    protocol: 'messages',
    base_url: 'https://api.anthropic.com',
    endpoint: '/v1/messages',
    auth_type: 'x-api-key',
    models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
    capabilities: ['coding', 'coding_backend', 'reasoning', 'analysis'],
    tags: ['code', 'reasoning'],
    keyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'gemini',
    name: 'Google (Gemini)',
    protocol: 'chat_completions',
    base_url: 'https://generativelanguage.googleapis.com',
    endpoint: '/v1beta/openai/chat/completions',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    capabilities: ['multilingual', 'long_context', 'coding'],
    tags: ['multilingual', 'long-context'],
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'chat_completions',
    base_url: 'https://api.deepseek.com',
    endpoint: '/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    capabilities: ['coding', 'reasoning', 'fast'],
    tags: ['code', 'reasoning', 'cheap'],
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'grok',
    name: 'xAI (Grok)',
    protocol: 'chat_completions',
    base_url: 'https://api.x.ai',
    endpoint: '/v1/chat/completions',
    models: ['grok-3', 'grok-3-mini', 'grok-3-fast'],
    capabilities: ['reasoning', 'fast'],
    tags: ['reasoning', 'fast'],
    keyPlaceholder: 'xai-...',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    protocol: 'chat_completions',
    base_url: 'https://api.mistral.ai',
    endpoint: '/v1/chat/completions',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest', 'mistral-small-latest'],
    capabilities: ['coding', 'multilingual'],
    tags: ['code', 'multilingual'],
    keyPlaceholder: 'Bearer token...',
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol: 'chat_completions',
    base_url: 'https://api.groq.com',
    endpoint: '/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    capabilities: ['fast'],
    tags: ['fast', 'cheap'],
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'chat_completions',
    base_url: 'https://openrouter.ai',
    endpoint: '/api/v1/chat/completions',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514', 'google/gemini-2.5-pro'],
    capabilities: [],
    tags: ['multi-provider'],
    keyPlaceholder: 'sk-or-...',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    protocol: 'chat_completions',
    base_url: 'http://localhost:11434',
    endpoint: '/v1/chat/completions',
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-r1'],
    capabilities: ['fast', 'coding'],
    tags: ['local', 'free'],
    keyPlaceholder: 'ollama (any value)',
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://YOUR_RESOURCE.openai.azure.com',
    endpoint: '/openai/deployments/YOUR_DEPLOYMENT/chat/completions?api-version=2024-10-21',
    models: ['gpt-4o'],
    capabilities: ['coding', 'tool_use'],
    tags: ['enterprise'],
    keyPlaceholder: 'Azure API key...',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'chat_completions',
    base_url: 'https://api.minimax.chat',
    endpoint: '/v1/text/chatcompletion_v2',
    models: ['MiniMax-M1', 'MiniMax-Text-01'],
    capabilities: ['multilingual'],
    tags: ['multilingual'],
    keyPlaceholder: 'Bearer token...',
  },
]

// ── Types ────────────────────────────────────────────────

interface NodeFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateNodeRequest | UpdateNodeRequest) => void
  isPending: boolean
  editNode?: NodeInfo | null
  existingIds: string[]
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
}: NodeFormModalProps) {
  const isEdit = !!editNode
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestNodeResponse | null>(null)
  const [useCustomEndpoint, setUseCustomEndpoint] = useState(false)
  const testNode = useTestNode()
  const testExisting = useTestExistingNode()

  // Reset when modal opens
  useEffect(() => {
    if (!open) return
    setTestResult(null)
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
        message: err.message || 'Request failed',
      })

    if (isEdit && !form.api_key.trim()) {
      testExisting.mutate(editNode!.id, {
        onSuccess: onResult,
        onError: onFail,
      })
      return
    }

    const errs: Record<string, string> = {}
    if (!form.base_url.trim()) errs.base_url = 'Required for test'
    if (!form.endpoint.trim()) errs.endpoint = 'Required for test'
    if (!form.api_key.trim()) errs.api_key = 'Required for test'
    const firstModel = form.models.find((m) => m.trim())
    if (!firstModel) errs.models = 'Need at least one model to test'

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
      if (!form.id.trim()) errs.id = 'ID is required'
      else if (!/^[a-z0-9_-]+$/i.test(form.id.trim()))
        errs.id = 'ID must be alphanumeric (a-z, 0-9, _, -)'
      else if (existingIds.includes(form.id.trim()))
        errs.id = 'A node with this ID already exists'

      if (!form.api_key.trim()) errs.api_key = 'API key is required'
      if (!form.endpoint.trim()) errs.endpoint = 'Endpoint is required'
    }

    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.base_url.trim()) errs.base_url = 'Base URL is required'

    const validModels = form.models.filter((m) => m.trim())
    if (validModels.length === 0) errs.models = 'At least one model is required'

    const timeout = Number(form.timeout_ms)
    if (isNaN(timeout) || timeout < 1) errs.timeout_ms = 'Must be a positive number'

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
      const data: UpdateNodeRequest = {
        name: form.name.trim(),
        protocol: form.protocol as CreateNodeRequest['protocol'],
        base_url: form.base_url.trim(),
        models,
        timeout_ms: Number(form.timeout_ms),
        capabilities: form.capabilities.length > 0 ? form.capabilities : undefined,
        tags: form.tags,
        model_aliases: Object.keys(aliasMap).length > 0 ? aliasMap : undefined,
      }
      if (form.api_key.trim()) data.api_key = form.api_key.trim()
      if (form.endpoint.trim()) data.endpoint = form.endpoint.trim()
      if (form.auth_type) data.auth_type = form.auth_type as 'bearer' | 'x-api-key'
      onSubmit(data)
    } else {
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
        auth_type: form.auth_type ? (form.auth_type as 'bearer' | 'x-api-key') : undefined,
      }
      onSubmit(data)
    }
  }

  if (!open) return null

  const presetInfo = selectedPreset
    ? PROVIDER_PRESETS.find((p) => p.id === selectedPreset)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-[var(--background)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
        {/* ─── Step 1: Provider Picker ─── */}
        {step === 'pick' && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
                Add Node &mdash; Choose Provider
              </h2>
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {PROVIDER_PRESETS.map((preset) => {
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
                        (add another)
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
                  Custom
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
                    title="Back to provider list"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
                  {isEdit
                    ? `Edit: ${editNode!.name}`
                    : presetInfo
                      ? `Add ${presetInfo.name} Node`
                      : 'Add Custom Node'}
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
                <FieldGroup label="Node ID" error={errors.id}>
                  <Input
                    value={form.id}
                    onChange={(e) => setField('id', e.target.value)}
                    placeholder="e.g. claude, gpt, gemini"
                  />
                </FieldGroup>
              )}

              {/* Name */}
              <FieldGroup label="Display Name" error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Claude (Anthropic)"
                />
              </FieldGroup>

              {/* API Key */}
              <FieldGroup
                label={isEdit ? 'API Key (blank = keep current, test uses saved key)' : 'API Key'}
                error={errors.api_key}
              >
                <Input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setField('api_key', e.target.value)}
                  placeholder={
                    isEdit
                      ? 'Leave blank to keep existing key'
                      : presetInfo?.keyPlaceholder ?? 'API key...'
                  }
                />
              </FieldGroup>

              {/* Protocol + Auth Type */}
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Protocol">
                  <Select
                    value={form.protocol}
                    onChange={(e) => {
                      const proto = e.target.value
                      setField('protocol', proto)
                      if (!useCustomEndpoint) {
                        setField('endpoint', PROTOCOL_ENDPOINTS[proto] || '')
                      }
                    }}
                    options={[
                      { value: 'chat_completions', label: 'Chat Completions (OpenAI)' },
                      { value: 'responses', label: 'Responses (OpenAI)' },
                      { value: 'messages', label: 'Messages (Anthropic)' },
                    ]}
                  />
                </FieldGroup>
                <FieldGroup label="Auth Type">
                  <Select
                    value={form.auth_type}
                    onChange={(e) => setField('auth_type', e.target.value)}
                    options={[
                      { value: '', label: 'Auto (based on protocol)' },
                      { value: 'bearer', label: 'Bearer Token' },
                      { value: 'x-api-key', label: 'x-api-key Header' },
                    ]}
                  />
                </FieldGroup>
              </div>

              {/* Base URL + Endpoint */}
              <FieldGroup label="Base URL" error={errors.base_url}>
                <Input
                  value={form.base_url}
                  onChange={(e) => setField('base_url', e.target.value)}
                  placeholder="https://api.openai.com"
                />
              </FieldGroup>

              <FieldGroup
                label="Endpoint"
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
                    Custom
                  </label>
                </div>
              </FieldGroup>

              {/* Timeout */}
              <FieldGroup label="Timeout (ms)" error={errors.timeout_ms}>
                <Input
                  type="number"
                  value={form.timeout_ms}
                  onChange={(e) => setField('timeout_ms', e.target.value)}
                  min={1}
                />
              </FieldGroup>

              {/* Models */}
              <FieldGroup label="Models" error={errors.models}>
                <div className="space-y-2">
                  {form.models.map((model, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={model}
                        onChange={(e) => updateModel(idx, e.target.value)}
                        placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
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
                    Add Model
                  </Button>
                </div>
              </FieldGroup>

              {/* Capabilities */}
              <FieldGroup label="Capabilities">
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
              <FieldGroup label="Custom Tags (optional)">
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
                      placeholder="e.g. reasoning, code, fast"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={addTag} type="button">
                      Add
                    </Button>
                  </div>
                </div>
              </FieldGroup>

              {/* Aliases */}
              <FieldGroup label="Model Aliases (optional)">
                <div className="space-y-2">
                  {form.aliases.map((alias, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={alias.key}
                        onChange={(e) => updateAlias(idx, 'key', e.target.value)}
                        placeholder="Alias (e.g. claude)"
                        className="flex-1"
                      />
                      <span className="flex items-center text-[var(--foreground-dim)]">&rarr;</span>
                      <Input
                        value={alias.value}
                        onChange={(e) => updateAlias(idx, 'value', e.target.value)}
                        placeholder="Model ID"
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeAlias(idx)} type="button">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addAlias} type="button">
                    <Plus className="h-3.5 w-3.5" />
                    Add Alias
                  </Button>
                </div>
              </FieldGroup>
            </div>

            {/* Test Connection + Result */}
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
                    Connectivity Test
                  </span>
                  {isEdit && !form.api_key.trim() && (
                    <span className="ml-2 text-[10px] text-[var(--foreground-dim)]">
                      (using saved config)
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
                  {isTestPending ? 'Testing...' : 'Test Connection'}
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
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending
                  ? isEdit ? 'Saving...' : 'Creating...'
                  : isEdit ? 'Save Changes' : 'Create Node'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
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

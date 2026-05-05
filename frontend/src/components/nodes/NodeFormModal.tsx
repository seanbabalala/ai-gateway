import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Settings2,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Server,
  MessageSquare,
  FileText,
  MessagesSquare,
  Database,
  ListFilter,
  ImageIcon,
  Volume2,
  Video,
  Radio,
  KeyRound,
  SlidersHorizontal,
  BadgeDollarSign,
  Activity,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { CapabilityPicker } from '@/components/shared/CapabilityPicker'
import { TierRecommendation } from '@/components/shared/TierRecommendation'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useTestNode, useTestExistingNode } from '@/hooks/use-mutations'
import { useProviderCatalogProviders } from '@/hooks/use-provider-catalog'
import type {
  CatalogEndpoint,
  CatalogModel,
  CatalogProvider,
  CreateNodeRequest,
  ModelCapabilityInfo,
  NodeInfo,
  TestNodeResponse,
  UpdateNodeRequest,
} from '@/types/api'

type Protocol = CreateNodeRequest['protocol']
type WizardStep = 'provider' | 'capabilities' | 'models' | 'settings' | 'test'
type ProviderFilter = 'all' | 'official' | 'compatible' | 'custom'
type WizardCapability =
  | 'chat'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'rerank'
  | 'images'
  | 'audio'
  | 'video'
  | 'realtime'
type ModelBucketKey =
  | 'models'
  | 'embedding_models'
  | 'rerank_models'
  | 'image_models'
  | 'audio_models'
  | 'video_models'
  | 'realtime_models'

const PROTOCOL_ENDPOINTS: Record<Protocol, string> = {
  chat_completions: '/v1/chat/completions',
  responses: '/v1/responses',
  messages: '/v1/messages',
}

const DEFAULT_ENDPOINTS = {
  embeddings_endpoint: '/v1/embeddings',
  rerank_endpoint: '/v1/rerank',
  images_generations_endpoint: '/v1/images/generations',
  images_edits_endpoint: '/v1/images/edits',
  audio_transcriptions_endpoint: '/v1/audio/transcriptions',
  audio_speech_endpoint: '/v1/audio/speech',
  video_generations_endpoint: '/v1/videos/generations',
  video_status_endpoint: '/v1/videos/{id}',
  realtime_endpoint: '/v1/realtime',
}

const WIZARD_STEPS: Array<{ id: WizardStep; labelKey: string }> = [
  { id: 'provider', labelKey: 'form.wizard.provider' },
  { id: 'capabilities', labelKey: 'form.wizard.capabilities' },
  { id: 'models', labelKey: 'form.wizard.models' },
  { id: 'settings', labelKey: 'form.wizard.settings' },
  { id: 'test', labelKey: 'form.wizard.test' },
]

const CAPABILITY_OPTIONS: Array<{
  id: WizardCapability
  labelKey: string
  icon: LucideIcon
}> = [
  { id: 'chat', labelKey: 'form.capabilityChoices.chat', icon: MessageSquare },
  { id: 'responses', labelKey: 'form.capabilityChoices.responses', icon: FileText },
  { id: 'messages', labelKey: 'form.capabilityChoices.messages', icon: MessagesSquare },
  { id: 'embeddings', labelKey: 'form.capabilityChoices.embeddings', icon: Database },
  { id: 'rerank', labelKey: 'form.capabilityChoices.rerank', icon: ListFilter },
  { id: 'images', labelKey: 'form.capabilityChoices.images', icon: ImageIcon },
  { id: 'audio', labelKey: 'form.capabilityChoices.audio', icon: Volume2 },
  { id: 'video', labelKey: 'form.capabilityChoices.video', icon: Video },
  { id: 'realtime', labelKey: 'form.capabilityChoices.realtime', icon: Radio },
]

const MODEL_BUCKETS: Array<{
  key: ModelBucketKey
  labelKey: string
  placeholderKey: string
  capabilities: WizardCapability[]
}> = [
  {
    key: 'models',
    labelKey: 'form.buckets.textModels',
    placeholderKey: 'form.placeholders.model',
    capabilities: ['chat', 'responses', 'messages'],
  },
  {
    key: 'embedding_models',
    labelKey: 'form.buckets.embeddingModels',
    placeholderKey: 'form.placeholders.embeddingModel',
    capabilities: ['embeddings'],
  },
  {
    key: 'rerank_models',
    labelKey: 'form.buckets.rerankModels',
    placeholderKey: 'form.placeholders.rerankModel',
    capabilities: ['rerank'],
  },
  {
    key: 'image_models',
    labelKey: 'form.buckets.imageModels',
    placeholderKey: 'form.placeholders.imageModel',
    capabilities: ['images'],
  },
  {
    key: 'audio_models',
    labelKey: 'form.buckets.audioModels',
    placeholderKey: 'form.placeholders.audioModel',
    capabilities: ['audio'],
  },
  {
    key: 'video_models',
    labelKey: 'form.buckets.videoModels',
    placeholderKey: 'form.placeholders.videoModel',
    capabilities: ['video'],
  },
  {
    key: 'realtime_models',
    labelKey: 'form.buckets.realtimeModels',
    placeholderKey: 'form.placeholders.realtimeModel',
    capabilities: ['realtime'],
  },
]

const BUCKET_MODALITIES: Record<ModelBucketKey, string[]> = {
  models: ['text'],
  embedding_models: ['text', 'embedding'],
  rerank_models: ['rerank'],
  image_models: ['image'],
  audio_models: ['audio'],
  video_models: ['video'],
  realtime_models: ['text', 'audio', 'realtime'],
}

interface ProviderPreset {
  id: string
  name: string
  description?: string
  category: ProviderFilter
  protocol: Protocol
  base_url: string
  endpoint: string
  endpoints: Partial<Record<CatalogEndpoint, string>>
  auth_type?: 'bearer' | 'x-api-key'
  buckets: Record<ModelBucketKey, string[]>
  suggestedCapabilities: WizardCapability[]
  model_prefixes: string[]
  aliases: string[]
  capabilities: string[]
  tags: string[]
  keyPlaceholder: string
  pricingRows: PricingRow[]
}

interface KeyValueRow {
  key: string
  value: string
}

interface PricingRow {
  model: string
  input: string
  output: string
  source?: string
  manual_review_required?: boolean
}

interface HealthCheckForm {
  enabled: boolean
  interval_seconds: string
  timeout_ms: string
  method: 'HEAD' | 'GET' | 'POST'
  path: string
  lightweight_model: string
}

interface FormState {
  id: string
  name: string
  protocol: Protocol
  base_url: string
  endpoint: string
  api_key: string
  timeout_ms: string
  models: string[]
  embedding_models: string[]
  rerank_models: string[]
  image_models: string[]
  audio_models: string[]
  video_models: string[]
  realtime_models: string[]
  embeddings_endpoint: string
  rerank_endpoint: string
  images_generations_endpoint: string
  images_edits_endpoint: string
  audio_transcriptions_endpoint: string
  audio_speech_endpoint: string
  video_generations_endpoint: string
  video_status_endpoint: string
  realtime_endpoint: string
  model_prefixes: string[]
  capabilities: string[]
  tags: string[]
  aliases: KeyValueRow[]
  headers: KeyValueRow[]
  pricing: PricingRow[]
  auth_type: string
  selectedCapabilities: WizardCapability[]
  max_concurrency: string
  queue_timeout_ms: string
  queue_policy: 'wait' | 'fallback' | 'reject'
  health_check: HealthCheckForm
}

interface NodeFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateNodeRequest | UpdateNodeRequest) => void
  isPending: boolean
  editNode?: NodeInfo | null
  existingIds: string[]
  existingNodes: NodeInfo[]
}

const EMPTY_HEALTH_CHECK: HealthCheckForm = {
  enabled: false,
  interval_seconds: '30',
  timeout_ms: '5000',
  method: 'HEAD',
  path: '/health',
  lightweight_model: '',
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
  embedding_models: [''],
  rerank_models: [''],
  image_models: [''],
  audio_models: [''],
  video_models: [''],
  realtime_models: [''],
  embeddings_endpoint: DEFAULT_ENDPOINTS.embeddings_endpoint,
  rerank_endpoint: DEFAULT_ENDPOINTS.rerank_endpoint,
  images_generations_endpoint: DEFAULT_ENDPOINTS.images_generations_endpoint,
  images_edits_endpoint: DEFAULT_ENDPOINTS.images_edits_endpoint,
  audio_transcriptions_endpoint: DEFAULT_ENDPOINTS.audio_transcriptions_endpoint,
  audio_speech_endpoint: DEFAULT_ENDPOINTS.audio_speech_endpoint,
  video_generations_endpoint: DEFAULT_ENDPOINTS.video_generations_endpoint,
  video_status_endpoint: DEFAULT_ENDPOINTS.video_status_endpoint,
  realtime_endpoint: DEFAULT_ENDPOINTS.realtime_endpoint,
  model_prefixes: [],
  capabilities: [],
  tags: [],
  aliases: [],
  headers: [],
  pricing: [],
  auth_type: '',
  selectedCapabilities: ['chat'],
  max_concurrency: '',
  queue_timeout_ms: '',
  queue_policy: 'wait',
  health_check: EMPTY_HEALTH_CHECK,
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function compactModels(values: string[]): string[] {
  return unique(values)
}

function nonEmptyRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.filter((row) => row.key.trim() || row.value.trim())
}

function toRecord(rows: KeyValueRow[]): Record<string, string> | undefined {
  const entries = rows
    .map((row) => [row.key.trim(), row.value.trim()] as const)
    .filter(([key, value]) => key && value)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function rowsFromRecord(record?: Record<string, string>): KeyValueRow[] {
  return Object.entries(record || {}).map(([key, value]) => ({ key, value }))
}

function ensureInputRows(values: string[]): string[] {
  return values.length > 0 ? values : ['']
}

function providerCategory(provider: CatalogProvider): ProviderFilter {
  if (provider.id === 'openai-compatible' || provider.auth_type === 'custom') return 'custom'
  if (
    provider.allows_unknown_models ||
    provider.tags?.includes('openai-compatible') ||
    provider.capabilities?.includes('openai_compatible') ||
    provider.capabilities?.includes('openai-compatible') ||
    ['openrouter', 'together', 'fireworks', 'ollama', 'vllm', 'groq'].includes(provider.id)
  ) {
    return 'compatible'
  }
  return 'official'
}

function providerCapabilities(provider: CatalogProvider): WizardCapability[] {
  const capabilities = new Set<WizardCapability>()
  if (provider.protocols.includes('chat_completions') || provider.endpoints.chat_completions) capabilities.add('chat')
  if (provider.protocols.includes('responses') || provider.endpoints.responses) capabilities.add('responses')
  if (provider.protocols.includes('messages') || provider.endpoints.messages) capabilities.add('messages')
  if (provider.endpoints.embeddings || provider.modalities.includes('embedding')) capabilities.add('embeddings')
  if (provider.endpoints.rerank || provider.modalities.includes('rerank')) capabilities.add('rerank')
  if (provider.endpoints.image_generations || provider.endpoints.image_edits || provider.modalities.includes('image')) capabilities.add('images')
  if (provider.endpoints.audio_transcriptions || provider.endpoints.audio_speech || provider.modalities.includes('audio')) capabilities.add('audio')
  if (provider.endpoints.video_generations || provider.endpoints.video_status || provider.modalities.includes('video')) capabilities.add('video')
  if (provider.endpoints.realtime || provider.modalities.includes('realtime')) capabilities.add('realtime')
  return Array.from(capabilities)
}

function bucketForModel(model: CatalogModel): ModelBucketKey | null {
  if (model.endpoints.includes('embeddings') || model.modalities.includes('embedding')) return 'embedding_models'
  if (model.endpoints.includes('rerank') || model.modalities.includes('rerank')) return 'rerank_models'
  if (model.endpoints.includes('image_generations') || model.endpoints.includes('image_edits') || model.modalities.includes('image')) return 'image_models'
  if (model.endpoints.includes('audio_transcriptions') || model.endpoints.includes('audio_speech') || model.modalities.includes('audio')) return 'audio_models'
  if (model.endpoints.includes('video_generations') || model.endpoints.includes('video_status') || model.modalities.includes('video')) return 'video_models'
  if (model.endpoints.includes('realtime') || model.modalities.includes('realtime')) return 'realtime_models'
  if (model.modalities.includes('text') || model.modalities.includes('vision')) return 'models'
  return null
}

function providerToPreset(provider: CatalogProvider): ProviderPreset {
  const protocol = provider.default_protocol || provider.protocols[0] || 'chat_completions'
  const buckets = Object.fromEntries(
    MODEL_BUCKETS.map((bucket) => [bucket.key, [] as string[]]),
  ) as Record<ModelBucketKey, string[]>
  const pricingRows: PricingRow[] = []

  for (const model of provider.models) {
    const bucket = bucketForModel(model)
    if (bucket) buckets[bucket].push(model.id)
    pricingRows.push({
      model: model.id,
      input: model.pricing.input === null || model.pricing.input === undefined ? '' : String(model.pricing.input),
      output: model.pricing.output === null || model.pricing.output === undefined ? '' : String(model.pricing.output),
      source: model.pricing.source,
      manual_review_required: model.pricing.manual_review_required,
    })
  }

  for (const bucket of MODEL_BUCKETS) {
    buckets[bucket.key] = unique(buckets[bucket.key]).slice(0, bucket.key === 'models' ? 10 : 6)
  }

  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    category: providerCategory(provider),
    protocol,
    base_url: provider.base_url,
    endpoint: provider.endpoints[protocol] || PROTOCOL_ENDPOINTS[protocol] || '/v1/chat/completions',
    endpoints: provider.endpoints,
    auth_type:
      provider.auth_type === 'bearer' || provider.auth_type === 'x-api-key'
        ? provider.auth_type
        : undefined,
    buckets,
    suggestedCapabilities: providerCapabilities(provider),
    model_prefixes: provider.model_prefixes || [],
    aliases: provider.aliases || [],
    capabilities: unique(provider.capabilities.filter((capability) => capability !== 'custom')),
    tags: provider.tags || [],
    keyPlaceholder: provider.key_placeholder || 'provider key...',
    pricingRows,
  }
}

function modelIdsForNode(node: NodeInfo): string[] {
  return unique([
    ...node.models,
    ...(node.embedding_models || []),
    ...(node.rerank_models || []),
    ...(node.image_models || []),
    ...(node.audio_models || []),
    ...(node.video_models || []),
    ...(node.realtime_models || []),
  ])
}

function activeBucketKeys(selectedCapabilities: WizardCapability[]): ModelBucketKey[] {
  return MODEL_BUCKETS
    .filter((bucket) => bucket.capabilities.some((capability) => selectedCapabilities.includes(capability)))
    .map((bucket) => bucket.key)
}

function deriveModalities(selectedCapabilities: WizardCapability[]): string[] {
  const modalities = new Set<string>()
  if (selectedCapabilities.some((capability) => ['chat', 'responses', 'messages'].includes(capability))) {
    modalities.add('text')
  }
  if (selectedCapabilities.includes('embeddings')) {
    modalities.add('text')
    modalities.add('embedding')
  }
  if (selectedCapabilities.includes('rerank')) modalities.add('rerank')
  if (selectedCapabilities.includes('images')) modalities.add('image')
  if (selectedCapabilities.includes('audio')) modalities.add('audio')
  if (selectedCapabilities.includes('video')) modalities.add('video')
  if (selectedCapabilities.includes('realtime')) modalities.add('realtime')
  return Array.from(modalities)
}

function endpointForCapability(preset: ProviderPreset, capability: WizardCapability): string | undefined {
  switch (capability) {
    case 'chat':
      return preset.endpoints.chat_completions
    case 'responses':
      return preset.endpoints.responses
    case 'messages':
      return preset.endpoints.messages
    case 'embeddings':
      return preset.endpoints.embeddings
    case 'rerank':
      return preset.endpoints.rerank
    case 'images':
      return preset.endpoints.image_generations
    case 'audio':
      return preset.endpoints.audio_transcriptions
    case 'video':
      return preset.endpoints.video_generations
    case 'realtime':
      return preset.endpoints.realtime
  }
}

function protocolFromCapability(capability: WizardCapability): Protocol | null {
  if (capability === 'chat') return 'chat_completions'
  if (capability === 'responses') return 'responses'
  if (capability === 'messages') return 'messages'
  return null
}

function pricingRowsFromCapabilities(capabilities?: Record<string, ModelCapabilityInfo>): PricingRow[] {
  return Object.entries(capabilities || {})
    .filter(([, capability]) => capability.pricing)
    .map(([model, capability]) => ({
      model,
      input: capability.pricing?.input === undefined ? '' : String(capability.pricing.input),
      output: capability.pricing?.output === undefined ? '' : String(capability.pricing.output),
      source: 'local',
      manual_review_required: false,
    }))
}

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
  const [step, setStep] = useState<WizardStep>('provider')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  const [providerSearch, setProviderSearch] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestNodeResponse | null>(null)
  const [prefixInput, setPrefixInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const testNode = useTestNode()
  const testExisting = useTestExistingNode()
  const providerCatalog = useProviderCatalogProviders(open && !isEdit)
  const providerPresets = useMemo(
    () => (providerCatalog.data?.providers || []).map(providerToPreset),
    [providerCatalog.data],
  )

  const presetInfo = selectedPreset
    ? providerPresets.find((preset) => preset.id === selectedPreset)
    : null

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

  useEffect(() => {
    if (!open) return
    setTestResult(null)
    setPrefixInput('')
    setTagInput('')
    setProviderFilter('all')
    setProviderSearch('')
    setErrors({})

    if (editNode) {
      const selectedCapabilities: WizardCapability[] = [
        editNode.protocol === 'chat_completions' ? 'chat' : editNode.protocol,
        ...(editNode.embedding_models?.length ? ['embeddings' as const] : []),
        ...(editNode.rerank_models?.length ? ['rerank' as const] : []),
        ...(editNode.image_models?.length ? ['images' as const] : []),
        ...(editNode.audio_models?.length ? ['audio' as const] : []),
        ...(editNode.video_models?.length ? ['video' as const] : []),
        ...(editNode.realtime_models?.length ? ['realtime' as const] : []),
      ]
      setStep('settings')
      setSelectedPreset(null)
      setForm({
        ...EMPTY_FORM,
        id: editNode.id,
        name: editNode.name,
        protocol: editNode.protocol,
        base_url: editNode.base_url,
        endpoint: editNode.endpoint || PROTOCOL_ENDPOINTS[editNode.protocol],
        api_key: '',
        models: ensureInputRows(editNode.models || []),
        embedding_models: ensureInputRows(editNode.embedding_models || []),
        rerank_models: ensureInputRows(editNode.rerank_models || []),
        image_models: ensureInputRows(editNode.image_models || []),
        audio_models: ensureInputRows(editNode.audio_models || []),
        video_models: ensureInputRows(editNode.video_models || []),
        realtime_models: ensureInputRows(editNode.realtime_models || []),
        embeddings_endpoint: editNode.endpoints?.embeddings || DEFAULT_ENDPOINTS.embeddings_endpoint,
        rerank_endpoint: editNode.endpoints?.rerank || DEFAULT_ENDPOINTS.rerank_endpoint,
        images_generations_endpoint: editNode.endpoints?.image_generations || DEFAULT_ENDPOINTS.images_generations_endpoint,
        images_edits_endpoint: editNode.endpoints?.image_edits || DEFAULT_ENDPOINTS.images_edits_endpoint,
        audio_transcriptions_endpoint: editNode.endpoints?.audio_transcriptions || DEFAULT_ENDPOINTS.audio_transcriptions_endpoint,
        audio_speech_endpoint: editNode.endpoints?.audio_speech || DEFAULT_ENDPOINTS.audio_speech_endpoint,
        video_generations_endpoint: editNode.endpoints?.video_generations || DEFAULT_ENDPOINTS.video_generations_endpoint,
        video_status_endpoint: editNode.endpoints?.video_status || DEFAULT_ENDPOINTS.video_status_endpoint,
        realtime_endpoint: editNode.endpoints?.realtime || DEFAULT_ENDPOINTS.realtime_endpoint,
        model_prefixes: editNode.model_prefixes || [],
        capabilities: editNode.capabilities || [],
        tags: editNode.tags || [],
        aliases: rowsFromRecord(editNode.aliases),
        selectedCapabilities,
        pricing: pricingRowsFromCapabilities(editNode.model_capabilities),
      })
      return
    }

    setStep('provider')
    setSelectedPreset(null)
    setForm({ ...EMPTY_FORM, health_check: { ...EMPTY_HEALTH_CHECK } })
  }, [open, editNode])

  const filteredPresets = useMemo(() => {
    const query = providerSearch.trim().toLowerCase()
    return providerPresets.filter((preset) => {
      if (providerFilter !== 'all' && preset.category !== providerFilter) return false
      if (!query) return true
      return (
        preset.name.toLowerCase().includes(query) ||
        preset.id.toLowerCase().includes(query) ||
        preset.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
        preset.model_prefixes.some((prefix) => prefix.toLowerCase().includes(query)) ||
        preset.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    })
  }, [providerPresets, providerFilter, providerSearch])

  const currentStepIndex = WIZARD_STEPS.findIndex((item) => item.id === step)
  const activeBuckets = activeBucketKeys(form.selectedCapabilities)
  const textModelForTest = compactModels(form.models)[0]
  const allActiveModels = unique(
    activeBuckets.flatMap((bucket) => compactModels(form[bucket] as string[])),
  )

  const pickPreset = (preset: ProviderPreset) => {
    let candidateId = preset.id
    let suffix = 2
    while (existingIds.includes(candidateId)) {
      candidateId = `${preset.id}-${suffix}`
      suffix += 1
    }

    const selectedCapabilities: WizardCapability[] = preset.suggestedCapabilities.length > 0
      ? preset.suggestedCapabilities
      : ['chat']

    setForm({
      ...EMPTY_FORM,
      id: candidateId,
      name: preset.name,
      protocol: preset.protocol,
      base_url: preset.base_url,
      endpoint: preset.endpoint,
      api_key: '',
      models: ensureInputRows(preset.buckets.models),
      embedding_models: ensureInputRows(preset.buckets.embedding_models),
      rerank_models: ensureInputRows(preset.buckets.rerank_models),
      image_models: ensureInputRows(preset.buckets.image_models),
      audio_models: ensureInputRows(preset.buckets.audio_models),
      video_models: ensureInputRows(preset.buckets.video_models),
      realtime_models: ensureInputRows(preset.buckets.realtime_models),
      embeddings_endpoint: preset.endpoints.embeddings || DEFAULT_ENDPOINTS.embeddings_endpoint,
      rerank_endpoint: preset.endpoints.rerank || DEFAULT_ENDPOINTS.rerank_endpoint,
      images_generations_endpoint: preset.endpoints.image_generations || DEFAULT_ENDPOINTS.images_generations_endpoint,
      images_edits_endpoint: preset.endpoints.image_edits || DEFAULT_ENDPOINTS.images_edits_endpoint,
      audio_transcriptions_endpoint: preset.endpoints.audio_transcriptions || DEFAULT_ENDPOINTS.audio_transcriptions_endpoint,
      audio_speech_endpoint: preset.endpoints.audio_speech || DEFAULT_ENDPOINTS.audio_speech_endpoint,
      video_generations_endpoint: preset.endpoints.video_generations || DEFAULT_ENDPOINTS.video_generations_endpoint,
      video_status_endpoint: preset.endpoints.video_status || DEFAULT_ENDPOINTS.video_status_endpoint,
      realtime_endpoint: preset.endpoints.realtime || DEFAULT_ENDPOINTS.realtime_endpoint,
      model_prefixes: [...preset.model_prefixes],
      capabilities: [...preset.capabilities],
      tags: [...preset.tags],
      auth_type: preset.auth_type || '',
      selectedCapabilities,
      pricing: preset.pricingRows.slice(0, 16),
      health_check: { ...EMPTY_HEALTH_CHECK },
    })
    setSelectedPreset(preset.id)
    setErrors({})
    setStep('capabilities')
  }

  const pickCustom = () => {
    setForm({ ...EMPTY_FORM, health_check: { ...EMPTY_HEALTH_CHECK } })
    setSelectedPreset(null)
    setErrors({})
    setStep('capabilities')
  }

  const toggleCapability = (capability: WizardCapability) => {
    const wasSelected = form.selectedCapabilities.includes(capability)
    const next = wasSelected
      ? form.selectedCapabilities.filter((item) => item !== capability)
      : [...form.selectedCapabilities, capability]
    const protocol = protocolFromCapability(capability)
    const nextTextProtocol =
      next.map(protocolFromCapability).find((item): item is Protocol => Boolean(item)) ||
      form.protocol
    setForm((prev) => ({
      ...prev,
      selectedCapabilities: next,
      ...(protocol && !wasSelected
        ? {
            protocol,
            endpoint: PROTOCOL_ENDPOINTS[protocol],
          }
        : protocol && wasSelected && protocol === prev.protocol
          ? {
              protocol: nextTextProtocol,
              endpoint: PROTOCOL_ENDPOINTS[nextTextProtocol],
            }
          : {}),
    }))
    setErrors((prev) => {
      const copy = { ...prev }
      delete copy.selectedCapabilities
      return copy
    })
  }

  const addModel = (bucket: ModelBucketKey) =>
    setForm((prev) => ({ ...prev, [bucket]: [...(prev[bucket] as string[]), ''] }))
  const removeModel = (bucket: ModelBucketKey, index: number) => {
    const next = (form[bucket] as string[]).filter((_, idx) => idx !== index)
    setForm((prev) => ({ ...prev, [bucket]: ensureInputRows(next) }))
  }
  const updateModel = (bucket: ModelBucketKey, index: number, value: string) =>
    setForm((prev) => ({
      ...prev,
      [bucket]: (prev[bucket] as string[]).map((item, idx) => (idx === index ? value : item)),
    }))
  const addSuggestedModel = (bucket: ModelBucketKey, model: string) => {
    const existing = compactModels(form[bucket] as string[])
    if (existing.includes(model)) return
    setForm((prev) => ({ ...prev, [bucket]: [...existing, model] }))
  }

  const addPrefix = () => {
    const prefix = prefixInput.trim()
    if (prefix && !form.model_prefixes.includes(prefix)) {
      setField('model_prefixes', [...form.model_prefixes, prefix])
    }
    setPrefixInput('')
  }
  const removePrefix = (prefix: string) =>
    setField('model_prefixes', form.model_prefixes.filter((item) => item !== prefix))

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags.includes(tag)) setField('tags', [...form.tags, tag])
    setTagInput('')
  }
  const removeTag = (tag: string) => setField('tags', form.tags.filter((item) => item !== tag))

  const addAlias = () => setField('aliases', [...form.aliases, { key: '', value: '' }])
  const removeAlias = (index: number) => setField('aliases', form.aliases.filter((_, idx) => idx !== index))
  const updateAlias = (index: number, field: keyof KeyValueRow, value: string) =>
    setField('aliases', form.aliases.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)))

  const addHeader = () => setField('headers', [...form.headers, { key: '', value: '' }])
  const removeHeader = (index: number) => setField('headers', form.headers.filter((_, idx) => idx !== index))
  const updateHeader = (index: number, field: keyof KeyValueRow, value: string) =>
    setField('headers', form.headers.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)))

  const addPricing = () => setField('pricing', [...form.pricing, { model: '', input: '', output: '' }])
  const removePricing = (index: number) => setField('pricing', form.pricing.filter((_, idx) => idx !== index))
  const updatePricing = (index: number, field: keyof PricingRow, value: string) =>
    setField('pricing', form.pricing.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)))

  const validateStep = (targetStep = step): boolean => {
    const errs: Record<string, string> = {}
    if (targetStep === 'capabilities' && form.selectedCapabilities.length === 0) {
      errs.selectedCapabilities = t('form.errors.capabilityRequired')
    }
    if (targetStep === 'models') {
      const active = activeBucketKeys(form.selectedCapabilities)
      const activeModelCount = active.reduce(
        (count, bucket) => count + compactModels(form[bucket] as string[]).length,
        0,
      )
      if (activeModelCount === 0) errs.models = t('form.errors.modelRequired')
      for (const bucket of active) {
        const models = compactModels(form[bucket] as string[])
        if (models.length !== (form[bucket] as string[]).filter((item) => item.trim()).length) {
          errs[bucket] = t('form.errors.modelsUnique')
        }
      }
    }
    if (targetStep === 'settings' || targetStep === 'test') {
      if (!isEdit) {
        if (!form.id.trim()) errs.id = t('form.errors.idRequired')
        else if (!/^[a-z0-9_-]+$/i.test(form.id.trim())) errs.id = t('form.errors.idFormat')
        else if (existingIds.includes(form.id.trim())) errs.id = t('form.errors.idExists')
        if (!form.api_key.trim()) errs.api_key = t('form.errors.apiKeyRequired')
      }
      if (!form.name.trim()) errs.name = t('form.errors.nameRequired')
      if (!form.base_url.trim()) errs.base_url = t('form.errors.baseUrlRequired')
      if (!form.endpoint.trim()) errs.endpoint = t('form.errors.endpointRequired')
      const timeout = Number(form.timeout_ms)
      if (Number.isNaN(timeout) || timeout < 1) errs.timeout_ms = t('form.errors.positiveNumber')
      if (form.max_concurrency && Number(form.max_concurrency) < 1) errs.max_concurrency = t('form.errors.positiveNumber')
      if (form.queue_timeout_ms && Number(form.queue_timeout_ms) < 0) errs.queue_timeout_ms = t('form.errors.nonNegativeNumber')
      const aliasNames = compactModels(form.aliases.map((alias) => alias.key))
      if (aliasNames.length !== nonEmptyRows(form.aliases).filter((alias) => alias.key.trim()).length) {
        errs.aliases = t('form.errors.aliasesUnique')
      }
      const headers = compactModels(form.headers.map((header) => header.key))
      if (headers.length !== nonEmptyRows(form.headers).filter((header) => header.key.trim()).length) {
        errs.headers = t('form.errors.headersUnique')
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const goNext = () => {
    if (!validateStep(step)) return
    const nextStep = WIZARD_STEPS[currentStepIndex + 1]?.id
    if (nextStep) setStep(nextStep)
  }

  const goBack = () => {
    const prevStep = WIZARD_STEPS[currentStepIndex - 1]?.id
    if (prevStep) setStep(prevStep)
  }

  const buildModelCapabilities = (): Record<string, Partial<ModelCapabilityInfo>> | undefined => {
    const entries: Array<[string, Partial<ModelCapabilityInfo>]> = []
    const activeModels = new Set(
      activeBucketKeys(form.selectedCapabilities).flatMap((bucket) =>
        compactModels(form[bucket] as string[]),
      ),
    )
    for (const row of form.pricing) {
      const model = row.model.trim()
      if (!model) continue
      if (!activeModels.has(model)) continue
      const input = Number(row.input)
      const output = Number(row.output)
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue
      const bucket = MODEL_BUCKETS.find((candidate) =>
        compactModels(form[candidate.key] as string[]).includes(model),
      )?.key
      entries.push([
        model,
        {
          ...(bucket ? { modalities: BUCKET_MODALITIES[bucket] } : {}),
          pricing: { input, output },
        },
      ])
    }
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  const buildHealthCheck = () => {
    const health = form.health_check
    if (!health.enabled) return undefined
    return {
      enabled: health.enabled,
      interval_seconds: Number(health.interval_seconds) || undefined,
      timeout_ms: Number(health.timeout_ms) || undefined,
      method: health.method,
      path: health.path.trim() || undefined,
      lightweight_model: health.lightweight_model.trim() || undefined,
    }
  }

  const buildPayload = (): CreateNodeRequest | UpdateNodeRequest => {
    const active = activeBucketKeys(form.selectedCapabilities)
    const modelPrefixes = compactModels(form.model_prefixes)
    const tags = compactModels(form.tags)
    const aliases = toRecord(form.aliases)
    const headers = toRecord(form.headers)
    const modelCapabilities = buildModelCapabilities()
    const healthCheck = buildHealthCheck()
    const textModels = active.includes('models') ? compactModels(form.models) : []

    const basePayload: UpdateNodeRequest = {
      name: form.name.trim(),
      protocol: form.protocol,
      base_url: form.base_url.trim(),
      endpoint: form.endpoint.trim(),
      models: textModels,
      embeddings_endpoint: active.includes('embedding_models') ? form.embeddings_endpoint.trim() : undefined,
      embedding_models: active.includes('embedding_models') ? compactModels(form.embedding_models) : undefined,
      rerank_endpoint: active.includes('rerank_models') ? form.rerank_endpoint.trim() : undefined,
      rerank_models: active.includes('rerank_models') ? compactModels(form.rerank_models) : undefined,
      images_generations_endpoint: active.includes('image_models') ? form.images_generations_endpoint.trim() : undefined,
      images_edits_endpoint: active.includes('image_models') ? form.images_edits_endpoint.trim() : undefined,
      image_models: active.includes('image_models') ? compactModels(form.image_models) : undefined,
      audio_transcriptions_endpoint: active.includes('audio_models') ? form.audio_transcriptions_endpoint.trim() : undefined,
      audio_speech_endpoint: active.includes('audio_models') ? form.audio_speech_endpoint.trim() : undefined,
      audio_models: active.includes('audio_models') ? compactModels(form.audio_models) : undefined,
      video_generations_endpoint: active.includes('video_models') ? form.video_generations_endpoint.trim() : undefined,
      video_status_endpoint: active.includes('video_models') ? form.video_status_endpoint.trim() : undefined,
      video_models: active.includes('video_models') ? compactModels(form.video_models) : undefined,
      realtime_endpoint: active.includes('realtime_models') ? form.realtime_endpoint.trim() : undefined,
      realtime_models: active.includes('realtime_models') ? compactModels(form.realtime_models) : undefined,
      timeout_ms: Number(form.timeout_ms),
      max_concurrency: form.max_concurrency ? Number(form.max_concurrency) : undefined,
      queue_timeout_ms: form.queue_timeout_ms ? Number(form.queue_timeout_ms) : undefined,
      queue_policy: form.max_concurrency || form.queue_timeout_ms ? form.queue_policy : undefined,
      capabilities: form.capabilities.length > 0 ? form.capabilities : undefined,
      modalities: deriveModalities(form.selectedCapabilities),
      tags: tags.length > 0 ? tags : undefined,
      model_aliases: aliases,
      model_prefixes: modelPrefixes.length > 0 ? modelPrefixes : undefined,
      headers,
      model_capabilities: modelCapabilities,
      auth_type: form.auth_type ? (form.auth_type as 'bearer' | 'x-api-key') : undefined,
      health_check: healthCheck,
    }

    if (form.api_key.trim()) basePayload.api_key = form.api_key.trim()
    if (isEdit) return basePayload

    return {
      ...basePayload,
      id: form.id.trim(),
      api_key: form.api_key.trim(),
    } as CreateNodeRequest
  }

  const handleSubmit = () => {
    if (!validateStep('settings') || !validateStep('models')) return
    onSubmit(buildPayload())
  }

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
      testExisting.mutate(editNode!.id, { onSuccess: onResult, onError: onFail })
      return
    }

    const errs: Record<string, string> = {}
    if (!form.base_url.trim()) errs.base_url = t('form.errors.requiredForTest')
    if (!form.endpoint.trim()) errs.endpoint = t('form.errors.requiredForTest')
    if (!form.api_key.trim()) errs.api_key = t('form.errors.requiredForTest')
    if (!textModelForTest) errs.models = t('form.errors.needModelForTest')
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    testNode.mutate(
      {
        protocol: form.protocol,
        base_url: form.base_url.trim(),
        endpoint: form.endpoint.trim(),
        api_key: form.api_key.trim(),
        model: textModelForTest,
        auth_type: form.auth_type ? (form.auth_type as 'bearer' | 'x-api-key') : undefined,
        headers: toRecord(form.headers),
      },
      { onSuccess: onResult, onError: onFail },
    )
  }

  const isTestPending = testNode.isPending || testExisting.isPending
  const isMatrixTestResult = Boolean(testResult?.matrix?.length)
  const currentNodeId = isEdit ? editNode!.id : form.id.trim()
  const otherNodes = existingNodes.filter((node) => node.id !== currentNodeId)
  const allNodeIds = existingNodes.map((node) => node.id)
  const otherModelOwners = otherNodes.flatMap((node) =>
    modelIdsForNode(node).map((model) => ({ model, nodeId: node.id })),
  )
  const allModelOwners = existingNodes.flatMap((node) =>
    modelIdsForNode(node).map((model) => ({ model, nodeId: node.id })),
  )
  const otherAliasOwners = otherNodes.flatMap((node) =>
    Object.keys(node.aliases || {}).map((alias) => ({ alias, nodeId: node.id })),
  )
  const otherPrefixOwners = otherNodes.flatMap((node) =>
    (node.model_prefixes || []).map((prefix) => ({ prefix, nodeId: node.id })),
  )
  const trimmedPrefixes = compactModels(form.model_prefixes)
  const trimmedAliases = form.aliases
    .map((alias) => ({ key: alias.key.trim(), value: alias.value.trim() }))
    .filter((alias) => alias.key || alias.value)
  const namingWarnings = [
    ...(!isEdit && form.id.trim() && allModelOwners.some((owner) => owner.model === form.id.trim())
      ? [t('form.warnings.upstreamIdMatchesModel', { id: form.id.trim() })]
      : []),
    ...allActiveModels
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
      .filter((alias) => alias.key && alias.value && !allActiveModels.includes(alias.value))
      .map((alias) => t('form.warnings.aliasTargetMissing', { alias: alias.key, target: alias.value })),
    ...trimmedPrefixes
      .filter((prefix) => otherPrefixOwners.some((owner) => owner.prefix === prefix))
      .map((prefix) => {
        const owners = otherPrefixOwners.filter((owner) => owner.prefix === prefix).map((owner) => owner.nodeId)
        return t('form.warnings.prefixAlreadyConfigured', { prefix, owners: owners.join(', ') })
      }),
  ].filter((warning, idx, arr) => arr.indexOf(warning) === idx)

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-5xl p-0">
        <div className="flex min-h-[620px] flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold tracking-tight text-[var(--foreground)]">
                {isEdit
                  ? t('form.editTitle', { name: editNode!.name })
                  : presetInfo
                    ? t('form.addProviderTitle', { name: presetInfo.name })
                    : t('form.wizard.title')}
              </h2>
              <div className="mt-1 text-[11px] font-semibold text-[var(--foreground-dim)]">
                {t(WIZARD_STEPS[currentStepIndex]?.labelKey || 'form.wizard.provider')}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-[var(--foreground-dim)] transition-all hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-[var(--border)] bg-[var(--background-secondary)]/70 px-4 py-4 lg:border-b-0 lg:border-r">
              <div className="space-y-2">
                {WIZARD_STEPS.map((item, index) => {
                  const active = item.id === step
                  const complete = index < currentStepIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (isEdit || index <= currentStepIndex) setStep(item.id)
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[12px] font-semibold transition-all ${
                        active
                          ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                          : 'text-[var(--foreground-muted)] hover:bg-[var(--inset-bg)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] ${
                          complete
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                            : active
                              ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                              : 'bg-[var(--background)] text-[var(--foreground-dim)]'
                        }`}
                      >
                        {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <span className="truncate">{t(item.labelKey)}</span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--foreground-dim)]">
                  {t('form.summary.title')}
                </div>
                <div className="mt-2 space-y-1.5 text-[11px] font-semibold text-[var(--foreground-muted)]">
                  <SummaryLine label={t('form.summary.provider')} value={presetInfo?.name || form.name || t('form.custom')} />
                  <SummaryLine label={t('form.summary.capabilities')} value={String(form.selectedCapabilities.length)} />
                  <SummaryLine label={t('form.summary.models')} value={String(allActiveModels.length)} />
                </div>
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto px-5 py-4">
              {step === 'provider' && (
                <ProviderStep
                  presets={filteredPresets}
                  loading={providerCatalog.isLoading}
                  selectedFilter={providerFilter}
                  search={providerSearch}
                  existingIds={existingIds}
                  onFilter={setProviderFilter}
                  onSearch={setProviderSearch}
                  onPick={pickPreset}
                  onCustom={pickCustom}
                  t={t}
                />
              )}

              {step === 'capabilities' && (
                <section className="space-y-4">
                  <SectionTitle icon={SlidersHorizontal} title={t('form.sections.capabilities')} />
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {CAPABILITY_OPTIONS.map((option) => {
                      const Icon = option.icon
                      const selected = form.selectedCapabilities.includes(option.id)
                      const available = !presetInfo || presetInfo.suggestedCapabilities.includes(option.id)
                      const endpoint = presetInfo ? endpointForCapability(presetInfo, option.id) : undefined
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleCapability(option.id)}
                          className={`flex min-h-[72px] items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all ${
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--foreground)]'
                              : 'border-[var(--border)] bg-[var(--background-secondary)] text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]'
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-bold">{t(option.labelKey)}</span>
                            <span className="mt-0.5 block truncate text-[10px] font-semibold text-[var(--foreground-dim)]">
                              {available ? endpoint || t('form.capabilityChoices.catalogReady') : t('form.capabilityChoices.customReady')}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {errors.selectedCapabilities && <ErrorText>{errors.selectedCapabilities}</ErrorText>}
                </section>
              )}

              {step === 'models' && (
                <section className="space-y-5">
                  <SectionTitle icon={Server} title={t('form.sections.models')} />
                  {MODEL_BUCKETS.filter((bucket) => activeBuckets.includes(bucket.key)).map((bucket) => (
                    <ModelBucketEditor
                      key={bucket.key}
                      bucket={bucket}
                      values={form[bucket.key] as string[]}
                      suggestions={presetInfo?.buckets[bucket.key] || []}
                      error={errors[bucket.key] || (bucket.key === 'models' ? errors.models : undefined)}
                      onAdd={() => addModel(bucket.key)}
                      onRemove={(index) => removeModel(bucket.key, index)}
                      onChange={(index, value) => updateModel(bucket.key, index, value)}
                      onPick={(model) => addSuggestedModel(bucket.key, model)}
                      t={t}
                    />
                  ))}
                </section>
              )}

              {step === 'settings' && (
                <section className="space-y-5">
                  <SectionTitle icon={Settings2} title={t('form.sections.settings')} />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel title={t('form.panels.identity')} icon={Server}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {!isEdit && (
                          <FieldGroup label={t('form.labels.upstreamId')} error={errors.id}>
                            <Input value={form.id} onChange={(event) => setField('id', event.target.value)} placeholder={t('form.placeholders.upstreamId')} />
                          </FieldGroup>
                        )}
                        <FieldGroup label={t('form.labels.displayName')} error={errors.name}>
                          <Input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder={t('form.placeholders.displayName')} />
                        </FieldGroup>
                        <FieldGroup label={isEdit ? t('form.labels.apiKeyEdit') : t('form.labels.apiKey')} error={errors.api_key}>
                          <Input
                            type="password"
                            value={form.api_key}
                            onChange={(event) => setField('api_key', event.target.value)}
                            placeholder={isEdit ? t('form.placeholders.keepExistingKey') : presetInfo?.keyPlaceholder || t('form.placeholders.apiKey')}
                          />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.authType')}>
                          <NativeSelect
                            value={form.auth_type}
                            onChange={(event) => setField('auth_type', event.target.value)}
                            options={[
                              { value: '', label: t('form.auth.auto') },
                              { value: 'bearer', label: t('form.auth.bearer') },
                              { value: 'x-api-key', label: t('form.auth.xApiKey') },
                            ]}
                          />
                        </FieldGroup>
                      </div>
                    </Panel>

                    <Panel title={t('form.panels.routingProtocol')} icon={KeyRound}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FieldGroup label={t('form.labels.protocol')}>
                          <NativeSelect
                            value={form.protocol}
                            onChange={(event) => {
                              const protocol = event.target.value as Protocol
                              setField('protocol', protocol)
                              setField('endpoint', PROTOCOL_ENDPOINTS[protocol])
                            }}
                            options={[
                              { value: 'chat_completions', label: t('form.protocol.chatCompletions') },
                              { value: 'responses', label: t('form.protocol.responses') },
                              { value: 'messages', label: t('form.protocol.messages') },
                            ]}
                          />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.timeout')} error={errors.timeout_ms}>
                          <Input type="number" min={1} value={form.timeout_ms} onChange={(event) => setField('timeout_ms', event.target.value)} />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.baseUrl')} error={errors.base_url}>
                          <Input value={form.base_url} onChange={(event) => setField('base_url', event.target.value)} placeholder={t('form.placeholders.baseUrl')} />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.endpoint')} error={errors.endpoint}>
                          <Input value={form.endpoint} onChange={(event) => setField('endpoint', event.target.value)} />
                        </FieldGroup>
                      </div>
                    </Panel>
                  </div>

                  <Panel title={t('form.panels.endpoints')} icon={SlidersHorizontal}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {activeBuckets.includes('embedding_models') && (
                        <FieldGroup label={t('form.labels.embeddingsEndpoint')}>
                          <Input value={form.embeddings_endpoint} onChange={(event) => setField('embeddings_endpoint', event.target.value)} />
                        </FieldGroup>
                      )}
                      {activeBuckets.includes('rerank_models') && (
                        <FieldGroup label={t('form.labels.rerankEndpoint')}>
                          <Input value={form.rerank_endpoint} onChange={(event) => setField('rerank_endpoint', event.target.value)} />
                        </FieldGroup>
                      )}
                      {activeBuckets.includes('image_models') && (
                        <>
                          <FieldGroup label={t('form.labels.imageGenerationsEndpoint')}>
                            <Input value={form.images_generations_endpoint} onChange={(event) => setField('images_generations_endpoint', event.target.value)} />
                          </FieldGroup>
                          <FieldGroup label={t('form.labels.imageEditsEndpoint')}>
                            <Input value={form.images_edits_endpoint} onChange={(event) => setField('images_edits_endpoint', event.target.value)} />
                          </FieldGroup>
                        </>
                      )}
                      {activeBuckets.includes('audio_models') && (
                        <>
                          <FieldGroup label={t('form.labels.audioTranscriptionsEndpoint')}>
                            <Input value={form.audio_transcriptions_endpoint} onChange={(event) => setField('audio_transcriptions_endpoint', event.target.value)} />
                          </FieldGroup>
                          <FieldGroup label={t('form.labels.audioSpeechEndpoint')}>
                            <Input value={form.audio_speech_endpoint} onChange={(event) => setField('audio_speech_endpoint', event.target.value)} />
                          </FieldGroup>
                        </>
                      )}
                      {activeBuckets.includes('video_models') && (
                        <>
                          <FieldGroup label={t('form.labels.videoGenerationsEndpoint')}>
                            <Input value={form.video_generations_endpoint} onChange={(event) => setField('video_generations_endpoint', event.target.value)} />
                          </FieldGroup>
                          <FieldGroup label={t('form.labels.videoStatusEndpoint')}>
                            <Input value={form.video_status_endpoint} onChange={(event) => setField('video_status_endpoint', event.target.value)} />
                          </FieldGroup>
                        </>
                      )}
                      {activeBuckets.includes('realtime_models') && (
                        <FieldGroup label={t('form.labels.realtimeEndpoint')}>
                          <Input value={form.realtime_endpoint} onChange={(event) => setField('realtime_endpoint', event.target.value)} />
                        </FieldGroup>
                      )}
                    </div>
                  </Panel>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel title={t('form.panels.headers')} icon={KeyRound} error={errors.headers}>
                      <KeyValueEditor
                        rows={form.headers}
                        keyPlaceholder={t('form.placeholders.headerName')}
                        valuePlaceholder={t('form.placeholders.headerValue')}
                        addLabel={t('form.actions.addHeader')}
                        onAdd={addHeader}
                        onRemove={removeHeader}
                        onChange={updateHeader}
                      />
                    </Panel>

                    <Panel title={t('form.panels.aliasesPrefixes')} icon={Server} error={errors.aliases || errors.model_prefixes}>
                      <div className="space-y-4">
                        <KeyValueEditor
                          rows={form.aliases}
                          keyPlaceholder={t('form.placeholders.alias')}
                          valuePlaceholder={t('form.placeholders.modelId')}
                          addLabel={t('form.actions.addAlias')}
                          onAdd={addAlias}
                          onRemove={removeAlias}
                          onChange={updateAlias}
                        />
                        <TokenEditor
                          values={form.model_prefixes}
                          input={prefixInput}
                          placeholder={t('form.placeholders.prefix')}
                          addLabel={t('form.actions.add')}
                          onInput={setPrefixInput}
                          onAdd={addPrefix}
                          onRemove={removePrefix}
                          suffix="-*"
                        />
                      </div>
                    </Panel>
                  </div>

                  <Panel title={t('form.panels.pricing')} icon={BadgeDollarSign}>
                    <PricingEditor
                      rows={form.pricing}
                      onAdd={addPricing}
                      onRemove={removePricing}
                      onChange={updatePricing}
                      t={t}
                    />
                  </Panel>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel title={t('form.panels.capabilityTags')} icon={SlidersHorizontal}>
                      <div className="space-y-4">
                        <CapabilityPicker selected={form.capabilities} onChange={(caps) => setField('capabilities', caps)} />
                        {form.capabilities.length > 0 && <TierRecommendation capabilities={form.capabilities} />}
                        <TokenEditor
                          values={form.tags}
                          input={tagInput}
                          placeholder={t('form.placeholders.tag')}
                          addLabel={t('form.actions.add')}
                          onInput={setTagInput}
                          onAdd={addTag}
                          onRemove={removeTag}
                        />
                      </div>
                    </Panel>

                    <Panel title={t('form.panels.healthQueue')} icon={Activity}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FieldGroup label={t('form.labels.maxConcurrency')} error={errors.max_concurrency}>
                          <Input type="number" min={1} value={form.max_concurrency} onChange={(event) => setField('max_concurrency', event.target.value)} placeholder="50" />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.queueTimeout')} error={errors.queue_timeout_ms}>
                          <Input type="number" min={0} value={form.queue_timeout_ms} onChange={(event) => setField('queue_timeout_ms', event.target.value)} placeholder="10000" />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.queuePolicy')}>
                          <NativeSelect
                            value={form.queue_policy}
                            onChange={(event) => setField('queue_policy', event.target.value as FormState['queue_policy'])}
                            options={[
                              { value: 'wait', label: t('form.queuePolicy.wait') },
                              { value: 'fallback', label: t('form.queuePolicy.fallback') },
                              { value: 'reject', label: t('form.queuePolicy.reject') },
                            ]}
                          />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthEnabled')}>
                          <label className="flex h-9 items-center gap-2 rounded-lg bg-[var(--background-secondary)] px-3 text-[12px] font-semibold text-[var(--foreground-muted)]">
                            <input
                              type="checkbox"
                              checked={form.health_check.enabled}
                              onChange={(event) => setField('health_check', { ...form.health_check, enabled: event.target.checked })}
                            />
                            {t('form.health.enabled')}
                          </label>
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthMethod')}>
                          <NativeSelect
                            value={form.health_check.method}
                            onChange={(event) => setField('health_check', { ...form.health_check, method: event.target.value as HealthCheckForm['method'] })}
                            options={[
                              { value: 'HEAD', label: 'HEAD' },
                              { value: 'GET', label: 'GET' },
                              { value: 'POST', label: 'POST' },
                            ]}
                          />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthPath')}>
                          <Input value={form.health_check.path} onChange={(event) => setField('health_check', { ...form.health_check, path: event.target.value })} />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthInterval')}>
                          <Input type="number" min={1} value={form.health_check.interval_seconds} onChange={(event) => setField('health_check', { ...form.health_check, interval_seconds: event.target.value })} />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthTimeout')}>
                          <Input type="number" min={1} value={form.health_check.timeout_ms} onChange={(event) => setField('health_check', { ...form.health_check, timeout_ms: event.target.value })} />
                        </FieldGroup>
                        <FieldGroup label={t('form.labels.healthModel')}>
                          <Input value={form.health_check.lightweight_model} onChange={(event) => setField('health_check', { ...form.health_check, lightweight_model: event.target.value })} placeholder={textModelForTest || t('form.placeholders.modelId')} />
                        </FieldGroup>
                      </div>
                    </Panel>
                  </div>

                  {namingWarnings.length > 0 && <Warnings warnings={namingWarnings} title={t('form.warnings.title')} />}
                </section>
              )}

              {step === 'test' && (
                <section className="space-y-5">
                  <SectionTitle icon={Zap} title={t('form.sections.test')} />
                  <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                    <Panel title={t('form.connectivity.title')} icon={Zap}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 text-[12px] font-semibold text-[var(--foreground-muted)]">
                          {textModelForTest
                            ? `${form.protocol} / ${textModelForTest}`
                            : t('form.connectivity.textOnly')}
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
                          disabled={isTestPending || !textModelForTest}
                        >
                          {isTestPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                          {isTestPending ? t('form.connectivity.testing') : t('form.connectivity.testConnection')}
                        </Button>
                      </div>
                      {testResult && (
                        <div
                          className={`mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs ${
                            testResult.success
                              ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-400'
                              : 'bg-red-500/8 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {testResult.success ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                          <div>
                            <div className="font-semibold">{testResult.message}</div>
                            {testResult.latency_ms > 0 && (
                              <div className="mt-0.5 font-mono opacity-70">
                                {isMatrixTestResult
                                  ? t('form.connectivity.summaryStatus')
                                  : t('form.connectivity.providerHttp')}{' '}
                                {testResult.status} / {testResult.latency_ms}ms
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </Panel>

                    <Panel title={t('form.summary.title')} icon={Server}>
                      <div className="space-y-2 text-[12px] font-semibold text-[var(--foreground-muted)]">
                        <SummaryLine label={t('form.summary.provider')} value={form.name || t('form.custom')} />
                        <SummaryLine label={t('form.summary.baseUrl')} value={form.base_url || '-'} />
                        <SummaryLine label={t('form.summary.models')} value={String(allActiveModels.length)} />
                        <SummaryLine label={t('form.summary.capabilities')} value={form.selectedCapabilities.map((cap) => t(`form.capabilityChoices.${cap}`)).join(', ')} />
                      </div>
                    </Panel>
                  </div>
                </section>
              )}
            </main>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-4">
            <div>
              {!isEdit && step !== 'provider' && (
                <Button variant="ghost" size="sm" onClick={step === 'capabilities' ? () => setStep('provider') : goBack}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('form.actions.back')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                {t('actions.cancel')}
              </Button>
              {step !== 'test' ? (
                <Button onClick={goNext}>
                  {t('form.actions.next')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={isPending}>
                  {isPending
                    ? isEdit ? t('actions.saving') : t('actions.creating')
                    : isEdit ? t('actions.saveChanges') : t('actions.createUpstream')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderStep({
  presets,
  loading,
  selectedFilter,
  search,
  existingIds,
  onFilter,
  onSearch,
  onPick,
  onCustom,
  t,
}: {
  presets: ProviderPreset[]
  loading: boolean
  selectedFilter: ProviderFilter
  search: string
  existingIds: string[]
  onFilter: (filter: ProviderFilter) => void
  onSearch: (value: string) => void
  onPick: (preset: ProviderPreset) => void
  onCustom: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const filters: ProviderFilter[] = ['all', 'official', 'compatible', 'custom']
  return (
    <section className="space-y-4">
      <SectionTitle icon={Server} title={t('form.sections.provider')} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--foreground-dim)]" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('form.placeholders.providerSearch')}
            className="pl-9"
          />
        </div>
        <div className="flex rounded-lg bg-[var(--background-secondary)] p-1">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onFilter(filter)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-bold transition-all ${
                selectedFilter === filter
                  ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--foreground-dim)] hover:text-[var(--foreground)]'
              }`}
            >
              {t(`form.providerFilters.${filter}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading && (
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--foreground-dim)]" />
          </div>
        )}
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPick(preset)}
            className="group flex min-h-[132px] flex-col items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-4 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--inset-bg)]"
          >
            <div className="flex w-full items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
                <NodeIcon
                  providerId={preset.id}
                  providerName={preset.name}
                  baseUrl={preset.base_url}
                  modelIds={Object.values(preset.buckets).flat()}
                  tags={preset.tags}
                  protocol={preset.protocol}
                  className="h-5 w-5"
                />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-extrabold text-[var(--foreground)]">{preset.name}</span>
                <span className="block truncate font-mono text-[10px] text-[var(--foreground-dim)]">{preset.base_url}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {preset.suggestedCapabilities.slice(0, 5).map((capability) => (
                <Badge key={capability} variant="zinc" className="text-[9px]">
                  {t(`form.capabilityChoices.${capability}`)}
                </Badge>
              ))}
              {preset.suggestedCapabilities.length > 5 && (
                <Badge variant="zinc" className="text-[9px]">+{preset.suggestedCapabilities.length - 5}</Badge>
              )}
            </div>
            {existingIds.includes(preset.id) && (
              <span className="text-[10px] font-semibold text-[var(--foreground-dim)]">
                {t('form.addAnother')}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={onCustom}
          className="flex min-h-[132px] flex-col items-start justify-between rounded-lg border border-dashed border-[var(--border)] bg-[var(--background-secondary)] p-4 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--inset-bg)]"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--background)]">
              <Settings2 className="h-5 w-5 text-[var(--foreground-dim)]" />
            </span>
            <span className="text-[13px] font-extrabold text-[var(--foreground)]">{t('form.custom')}</span>
          </span>
          <span className="font-mono text-[10px] text-[var(--foreground-dim)]">
            {t('form.providerFilters.custom')}
          </span>
        </button>
      </div>
    </section>
  )
}

function ModelBucketEditor({
  bucket,
  values,
  suggestions,
  error,
  onAdd,
  onRemove,
  onChange,
  onPick,
  t,
}: {
  bucket: (typeof MODEL_BUCKETS)[number]
  values: string[]
  suggestions: string[]
  error?: string
  onAdd: () => void
  onRemove: (index: number) => void
  onChange: (index: number, value: string) => void
  onPick: (model: string) => void
  t: (key: string) => string
}) {
  const selected = compactModels(values)
  const remaining = suggestions.filter((model) => !selected.includes(model)).slice(0, 8)
  return (
    <Panel title={t(bucket.labelKey)} icon={Server} error={error}>
      {remaining.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {remaining.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => onPick(model)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[10px] font-semibold text-[var(--foreground-muted)] transition-all hover:border-[var(--accent)] hover:text-[var(--foreground)]"
            >
              + {model}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {values.map((model, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={model}
              onChange={(event) => onChange(index, event.target.value)}
              placeholder={t(bucket.placeholderKey)}
              className="font-mono"
            />
            <Button variant="ghost" size="icon" onClick={() => onRemove(index)} type="button" disabled={values.length === 1 && !model.trim()}>
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={onAdd} type="button">
          <Plus className="h-3.5 w-3.5" />
          {t('form.actions.addModel')}
        </Button>
      </div>
    </Panel>
  )
}

function PricingEditor({
  rows,
  onAdd,
  onRemove,
  onChange,
  t,
}: {
  rows: PricingRow[]
  onAdd: () => void
  onRemove: (index: number) => void
  onChange: (index: number, field: keyof PricingRow, value: string) => void
  t: (key: string) => string
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${row.model}-${index}`} className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_120px_120px_36px]">
          <Input value={row.model} onChange={(event) => onChange(index, 'model', event.target.value)} placeholder={t('form.placeholders.modelId')} className="font-mono" />
          <Input value={row.input} onChange={(event) => onChange(index, 'input', event.target.value)} placeholder={t('form.placeholders.priceInput')} />
          <Input value={row.output} onChange={(event) => onChange(index, 'output', event.target.value)} placeholder={t('form.placeholders.priceOutput')} />
          <Button variant="ghost" size="icon" type="button" onClick={() => onRemove(index)}>
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
          {row.manual_review_required && (
            <div className="md:col-span-4 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {t('form.pricing.manualReview')}
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" type="button" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        {t('form.actions.addPricing')}
      </Button>
    </div>
  )
}

function KeyValueEditor({
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  onAdd,
  onRemove,
  onChange,
}: {
  rows: KeyValueRow[]
  keyPlaceholder: string
  valuePlaceholder: string
  addLabel: string
  onAdd: () => void
  onRemove: (index: number) => void
  onChange: (index: number, field: keyof KeyValueRow, value: string) => void
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2">
          <Input value={row.key} onChange={(event) => onChange(index, 'key', event.target.value)} placeholder={keyPlaceholder} />
          <Input value={row.value} onChange={(event) => onChange(index, 'value', event.target.value)} placeholder={valuePlaceholder} />
          <Button variant="ghost" size="icon" type="button" onClick={() => onRemove(index)}>
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" type="button" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  )
}

function TokenEditor({
  values,
  input,
  placeholder,
  addLabel,
  suffix = '',
  onInput,
  onAdd,
  onRemove,
}: {
  values: string[]
  input: string
  placeholder: string
  addLabel: string
  suffix?: string
  onInput: (value: string) => void
  onAdd: () => void
  onRemove: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--inset-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground-muted)]"
          >
            {value}{suffix}
            <button type="button" onClick={() => onRemove(value)} className="text-[var(--foreground-dim)] transition-colors hover:text-red-500">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onAdd()
            }
          }}
        />
        <Button variant="outline" size="sm" onClick={onAdd} type="button">
          {addLabel}
        </Button>
      </div>
    </div>
  )
}

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--foreground-dim)]">
        {label}
      </label>
      {children}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  )
}

function Panel({
  title,
  icon: Icon,
  error,
  children,
}: {
  title: string
  icon: LucideIcon
  error?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-extrabold text-[var(--foreground)]">
        <Icon className="h-4 w-4 text-[var(--foreground-dim)]" />
        {title}
      </div>
      {children}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  )
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="text-[16px] font-extrabold text-[var(--foreground)]">{title}</h3>
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[var(--foreground-dim)]">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-[var(--foreground)]">{value}</span>
    </div>
  )
}

function Warnings({ title, warnings }: { title: string; warnings: string[] }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-amber-800 dark:text-amber-300">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold">{title}</div>
          <div className="mt-1 space-y-1">
            {warnings.map((warning) => (
              <p key={warning} className="text-[11px] leading-5">
                {warning}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorText({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[11px] font-medium text-red-500">{children}</p>
}

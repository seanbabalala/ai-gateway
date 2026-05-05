import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NodeIconProps {
  /** Node ID (e.g. "gpt", "claude", "openai") — used for provider detection */
  nodeId?: string
  /** Catalog provider ID, when the caller has it. This wins over protocol and keyword hints. */
  providerId?: string
  /** Provider or node display name, used as a secondary detection hint. */
  providerName?: string
  /** Node/provider base URL, used to identify compatible providers without relying on protocol. */
  baseUrl?: string
  /** Configured model IDs for nodes whose ID is generic but model family is provider-specific. */
  modelIds?: string[]
  /** Provider or node tags, for custom OpenAI-compatible fallbacks. */
  tags?: string[]
  /** Protocol name — fallback when nodeId doesn't match a known provider */
  protocol?: string
  className?: string
  style?: CSSProperties
}

/**
 * Provider identity registry.
 *
 * Some providers have shipped SVG assets under public/providers. Providers without a
 * committed asset use a branded local badge instead of falling back to the OpenAI mark.
 */
export interface ProviderIdentity {
  id: string
  label: string
  keywords: string[]
  hostnames?: string[]
  modelPrefixes?: string[]
  logo?: string
  invertInDark?: boolean
  badge?: string
  badgeClassName?: string
}

const PROVIDER_REGISTRY: ProviderIdentity[] = [
  // Exact/catalog IDs and hostnames are checked before fuzzy keywords, so Azure/Voyage
  // do not get swallowed by generic OpenAI-compatible protocol behavior.
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    keywords: ['azure-openai', 'azure openai', 'azure'],
    hostnames: ['openai.azure.com'],
    logo: '/providers/azure.svg',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keywords: ['openai', 'gpt', 'o1-', 'o3-', 'o4-', 'dall-e', 'text-embedding-3'],
    hostnames: ['api.openai.com'],
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-', 'text-embedding-3', 'dall-e'],
    logo: '/providers/openai.svg',
    invertInDark: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keywords: ['claude', 'anthropic'],
    hostnames: ['api.anthropic.com'],
    modelPrefixes: ['claude-'],
    logo: '/providers/anthropic.svg',
    invertInDark: true,
  },
  {
    id: 'google-gemini',
    label: 'Google Gemini',
    keywords: ['google-gemini', 'gemini'],
    hostnames: ['generativelanguage.googleapis.com'],
    modelPrefixes: ['gemini', 'imagen', 'veo'],
    logo: '/providers/gemini.svg',
  },
  {
    id: 'google-vertex',
    label: 'Google Vertex AI',
    keywords: ['google-vertex', 'vertex', 'vertex ai'],
    hostnames: ['aiplatform.googleapis.com'],
    logo: '/providers/google.svg',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keywords: ['openrouter'],
    hostnames: ['openrouter.ai'],
    logo: '/providers/openrouter.svg',
    invertInDark: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    keywords: ['groq'],
    hostnames: ['api.groq.com'],
    logo: '/providers/groq.svg',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    keywords: ['mistral', 'mixtral', 'codestral', 'pixtral'],
    hostnames: ['api.mistral.ai'],
    modelPrefixes: ['mistral', 'mixtral', 'codestral', 'pixtral'],
    logo: '/providers/mistral.svg',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keywords: ['deepseek'],
    hostnames: ['api.deepseek.com'],
    modelPrefixes: ['deepseek'],
    logo: '/providers/deepseek.svg',
  },
  {
    id: 'xai',
    label: 'xAI',
    keywords: ['xai', 'x.ai', 'grok'],
    hostnames: ['api.x.ai'],
    modelPrefixes: ['grok'],
    logo: '/providers/xai.svg',
    invertInDark: true,
  },
  {
    id: 'cohere',
    label: 'Cohere',
    keywords: ['cohere', 'command-r'],
    hostnames: ['api.cohere.com'],
    modelPrefixes: ['command', 'embed-', 'rerank-english', 'rerank-multilingual'],
    logo: '/providers/cohere.svg',
  },
  {
    id: 'voyage',
    label: 'Voyage AI',
    keywords: ['voyage', 'voyageai'],
    hostnames: ['api.voyageai.com'],
    modelPrefixes: ['voyage-'],
    badge: 'V',
    badgeClassName: 'bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-950',
  },
  {
    id: 'jina',
    label: 'Jina AI',
    keywords: ['jina'],
    hostnames: ['api.jina.ai'],
    modelPrefixes: ['jina-'],
    badge: 'J',
    badgeClassName: 'bg-pink-600 text-white dark:bg-pink-400 dark:text-slate-950',
  },
  {
    id: 'together',
    label: 'Together AI',
    keywords: ['together', 'together ai'],
    hostnames: ['api.together.xyz'],
    badge: 'T',
    badgeClassName: 'bg-emerald-600 text-white dark:bg-emerald-400 dark:text-slate-950',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    keywords: ['fireworks'],
    hostnames: ['api.fireworks.ai'],
    badge: 'F',
    badgeClassName: 'bg-orange-600 text-white dark:bg-orange-400 dark:text-slate-950',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    keywords: ['ollama'],
    hostnames: ['localhost:11434', '127.0.0.1:11434'],
    logo: '/providers/ollama.svg',
    invertInDark: true,
  },
  {
    id: 'vllm',
    label: 'vLLM',
    keywords: ['vllm', 'vllm-compatible'],
    hostnames: ['localhost:8000', '127.0.0.1:8000'],
    badge: 'v',
    badgeClassName: 'bg-sky-600 text-white dark:bg-sky-400 dark:text-slate-950',
  },
  {
    id: 'aws-bedrock',
    label: 'AWS Bedrock',
    keywords: ['aws-bedrock', 'bedrock', 'amazon bedrock'],
    hostnames: ['bedrock-runtime', 'amazonaws.com'],
    modelPrefixes: ['amazon.', 'anthropic.', 'us.amazon.', 'us.anthropic.'],
    logo: '/providers/amazon.svg',
  },
  {
    id: 'alibaba-qwen',
    label: 'Alibaba Qwen',
    keywords: ['alibaba-qwen', 'qwen', 'dashscope', 'tongyi', '通义', '千问'],
    hostnames: ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'],
    modelPrefixes: ['qwen', 'qwq', 'qvq', 'wan', 'text-embedding-v'],
    logo: '/providers/qwen.svg',
  },
  {
    id: 'baidu-qianfan',
    label: 'Baidu Qianfan',
    keywords: ['baidu-qianfan', 'qianfan', 'wenxin', 'baidu', 'ernie', '文心', '千帆'],
    hostnames: ['qianfan.baidubce.com', 'aip.baidubce.com'],
    modelPrefixes: ['ernie', 'wenxin', 'bge'],
    badge: 'B',
    badgeClassName: 'bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950',
  },
  {
    id: 'volcengine-ark',
    label: 'Volcengine Ark',
    keywords: ['volcengine-ark', 'volcengine', 'ark', 'doubao', '火山', '豆包'],
    hostnames: ['ark.cn-beijing.volces.com', 'volces.com'],
    modelPrefixes: ['doubao', 'ep-'],
    badge: 'D',
    badgeClassName: 'bg-rose-600 text-white dark:bg-rose-400 dark:text-slate-950',
  },
  {
    id: 'tencent-hunyuan',
    label: 'Tencent Hunyuan',
    keywords: ['tencent-hunyuan', 'hunyuan', 'tencent', '混元', '腾讯'],
    hostnames: ['hunyuan.cloud.tencent.com', 'cloud.tencent.com'],
    modelPrefixes: ['hunyuan', 'hy-'],
    badge: 'H',
    badgeClassName: 'bg-cyan-700 text-white dark:bg-cyan-300 dark:text-slate-950',
  },
  {
    id: '01ai',
    label: '01.AI',
    keywords: ['01ai', '01.ai', 'lingyiwanwu', '零一万物'],
    hostnames: ['lingyiwanwu.com', '01.ai'],
    modelPrefixes: ['yi-'],
    badge: '01',
    badgeClassName: 'bg-slate-900 text-white dark:bg-white dark:text-slate-950',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    keywords: ['replicate'],
    hostnames: ['api.replicate.com', 'replicate.com'],
    modelPrefixes: ['black-forest-labs/', 'minimax/', 'stability-ai/'],
    badge: 'R',
    badgeClassName: 'bg-black text-white dark:bg-white dark:text-slate-950',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    keywords: ['perplexity', 'pplx', 'sonar'],
    hostnames: ['api.perplexity.ai'],
    modelPrefixes: ['sonar'],
    badge: 'P',
    badgeClassName: 'bg-teal-700 text-white dark:bg-teal-300 dark:text-slate-950',
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    keywords: ['nvidia-nim', 'nvidia', 'nim'],
    hostnames: ['integrate.api.nvidia.com', 'build.nvidia.com'],
    modelPrefixes: ['nvidia/', 'meta/', 'mistralai/', 'qwen/'],
    logo: '/providers/nvidia.svg',
  },
  {
    id: 'sambanova',
    label: 'SambaNova Cloud',
    keywords: ['sambanova', 'samba nova'],
    hostnames: ['api.sambanova.ai'],
    modelPrefixes: ['meta-llama', 'llama', 'deepseek', 'qwen'],
    badge: 'S',
    badgeClassName: 'bg-violet-700 text-white dark:bg-violet-300 dark:text-slate-950',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    keywords: ['huggingface', 'hugging face', 'hf', 'inference providers'],
    hostnames: ['huggingface.co', 'router.huggingface.co'],
    modelPrefixes: ['meta-llama/', 'mistralai/', 'qwen/', 'sentence-transformers/'],
    badge: 'HF',
    badgeClassName: 'bg-yellow-400 text-slate-950 dark:bg-yellow-300 dark:text-slate-950',
  },
  {
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    keywords: ['cloudflare-workers-ai', 'cloudflare', 'workers ai'],
    hostnames: ['api.cloudflare.com'],
    modelPrefixes: ['@cf/', '@hf/'],
    badge: 'CF',
    badgeClassName: 'bg-orange-500 text-white dark:bg-orange-300 dark:text-slate-950',
  },
  {
    id: 'ibm-watsonx',
    label: 'IBM watsonx.ai',
    keywords: ['ibm-watsonx', 'watsonx', 'watsonx.ai', 'ibm'],
    hostnames: ['ml.cloud.ibm.com'],
    modelPrefixes: ['ibm/', 'meta-llama/', 'mistralai/'],
    badge: 'IBM',
    badgeClassName: 'bg-blue-700 text-white dark:bg-blue-300 dark:text-slate-950',
  },
  {
    id: 'baseten',
    label: 'Baseten',
    keywords: ['baseten', 'truss'],
    hostnames: ['api.baseten.co'],
    modelPrefixes: ['baseten/', 'baseten-', 'custom-'],
    badge: 'B10',
    badgeClassName: 'bg-purple-700 text-white dark:bg-purple-300 dark:text-slate-950',
  },
  {
    id: 'lepton',
    label: 'Lepton AI',
    keywords: ['lepton', 'lepton ai'],
    hostnames: ['api.lepton.ai', 'lepton.ai'],
    modelPrefixes: ['llama', 'qwen', 'mistral'],
    badge: 'L',
    badgeClassName: 'bg-cyan-700 text-white dark:bg-cyan-300 dark:text-slate-950',
  },
  {
    id: 'modal',
    label: 'Modal',
    keywords: ['modal', 'modal labs'],
    hostnames: ['modal.run', 'modal.com'],
    modelPrefixes: ['modal/', 'modal-', 'custom-'],
    badge: 'M',
    badgeClassName: 'bg-slate-900 text-white dark:bg-white dark:text-slate-950',
  },
  {
    id: 'runpod',
    label: 'RunPod',
    keywords: ['runpod', 'runpod serverless'],
    hostnames: ['api.runpod.ai', 'runpod.io'],
    modelPrefixes: ['runpod/', 'runpod-'],
    badge: 'RP',
    badgeClassName: 'bg-emerald-700 text-white dark:bg-emerald-300 dark:text-slate-950',
  },
  {
    id: 'predibase',
    label: 'Predibase',
    keywords: ['predibase', 'lorax'],
    hostnames: ['predibase.com', 'serving.app.predibase.com'],
    modelPrefixes: ['predibase/'],
    badge: 'PB',
    badgeClassName: 'bg-fuchsia-700 text-white dark:bg-fuchsia-300 dark:text-slate-950',
  },
  {
    id: 'lamini',
    label: 'Lamini',
    keywords: ['lamini'],
    hostnames: ['api.lamini.ai', 'lamini.ai'],
    modelPrefixes: ['lamini'],
    badge: 'LA',
    badgeClassName: 'bg-red-700 text-white dark:bg-red-300 dark:text-slate-950',
  },
  {
    id: 'ai21',
    label: 'AI21 Labs',
    keywords: ['ai21', 'jamba'],
    hostnames: ['api.ai21.com', 'ai21.com'],
    modelPrefixes: ['jamba'],
    badge: '21',
    badgeClassName: 'bg-indigo-700 text-white dark:bg-indigo-300 dark:text-slate-950',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    keywords: ['fal', 'fal.ai'],
    hostnames: ['fal.ai', 'queue.fal.run'],
    modelPrefixes: ['fal-ai/'],
    badge: 'fal',
    badgeClassName: 'bg-lime-500 text-slate-950 dark:bg-lime-300 dark:text-slate-950',
  },
  {
    id: 'stability-ai',
    label: 'Stability AI',
    keywords: ['stability-ai', 'stability', 'stable diffusion'],
    hostnames: ['api.stability.ai', 'platform.stability.ai'],
    modelPrefixes: ['stable-', 'sd3'],
    badge: 'S',
    badgeClassName: 'bg-blue-950 text-white dark:bg-blue-200 dark:text-slate-950',
  },
  {
    id: 'black-forest-labs',
    label: 'Black Forest Labs',
    keywords: ['black-forest-labs', 'black forest labs', 'bfl', 'flux'],
    hostnames: ['api.bfl.ai', 'blackforestlabs.ai'],
    modelPrefixes: ['flux'],
    badge: 'FLX',
    badgeClassName: 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-slate-950',
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    keywords: ['ideogram'],
    hostnames: ['api.ideogram.ai', 'ideogram.ai'],
    modelPrefixes: ['ideogram'],
    badge: 'ID',
    badgeClassName: 'bg-pink-700 text-white dark:bg-pink-300 dark:text-slate-950',
  },
  {
    id: 'luma',
    label: 'Luma AI',
    keywords: ['luma', 'luma ai', 'dream machine'],
    hostnames: ['api.lumalabs.ai', 'lumalabs.ai'],
    modelPrefixes: ['ray', 'dream-machine'],
    badge: 'LU',
    badgeClassName: 'bg-sky-700 text-white dark:bg-sky-300 dark:text-slate-950',
  },
  {
    id: 'runway',
    label: 'Runway',
    keywords: ['runway', 'runwayml', 'gen-4'],
    hostnames: ['api.dev.runwayml.com', 'runwayml.com'],
    modelPrefixes: ['gen4', 'gen3'],
    badge: 'RW',
    badgeClassName: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-slate-950',
  },
  {
    id: 'pika',
    label: 'Pika',
    keywords: ['pika', 'pika labs'],
    hostnames: ['api.pika.art', 'pika.art'],
    modelPrefixes: ['pika'],
    badge: 'PK',
    badgeClassName: 'bg-amber-500 text-slate-950 dark:bg-amber-300 dark:text-slate-950',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    keywords: ['elevenlabs', 'eleven labs', '11labs'],
    hostnames: ['api.elevenlabs.io', 'elevenlabs.io'],
    modelPrefixes: ['eleven_', 'scribe_'],
    badge: '11',
    badgeClassName: 'bg-black text-white dark:bg-white dark:text-slate-950',
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    keywords: ['deepgram'],
    hostnames: ['api.deepgram.com', 'deepgram.com'],
    modelPrefixes: ['nova', 'aura'],
    badge: 'DG',
    badgeClassName: 'bg-emerald-900 text-white dark:bg-emerald-200 dark:text-slate-950',
  },
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    keywords: ['assemblyai', 'assembly ai'],
    hostnames: ['api.assemblyai.com', 'assemblyai.com'],
    modelPrefixes: ['best', 'nano'],
    badge: 'AA',
    badgeClassName: 'bg-violet-900 text-white dark:bg-violet-200 dark:text-slate-950',
  },
  {
    id: 'cartesia',
    label: 'Cartesia',
    keywords: ['cartesia', 'sonic'],
    hostnames: ['api.cartesia.ai', 'cartesia.ai'],
    modelPrefixes: ['sonic'],
    badge: 'CT',
    badgeClassName: 'bg-teal-800 text-white dark:bg-teal-200 dark:text-slate-950',
  },
  {
    id: 'speechmatics',
    label: 'Speechmatics',
    keywords: ['speechmatics'],
    hostnames: ['asr.api.speechmatics.com', 'speechmatics.com'],
    modelPrefixes: ['speechmatics'],
    badge: 'SM',
    badgeClassName: 'bg-cyan-950 text-white dark:bg-cyan-200 dark:text-slate-950',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    keywords: ['lm-studio', 'lm studio', 'lmstudio'],
    hostnames: ['localhost:1234', '127.0.0.1:1234'],
    modelPrefixes: ['local', 'llama', 'qwen', 'mistral', 'gemma'],
    badge: 'LM',
    badgeClassName: 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-950',
  },
  {
    id: 'llama-cpp',
    label: 'llama.cpp server',
    keywords: ['llama-cpp', 'llama.cpp', 'llama cpp', 'llamacpp'],
    hostnames: ['localhost:8080', '127.0.0.1:8080'],
    modelPrefixes: ['gguf'],
    badge: 'GGUF',
    badgeClassName: 'bg-stone-700 text-white dark:bg-stone-300 dark:text-slate-950',
  },
  {
    id: 'huggingface-tgi',
    label: 'Text Generation Inference',
    keywords: ['huggingface-tgi', 'tgi', 'text generation inference', 'hf tgi'],
    hostnames: ['localhost:8080', '127.0.0.1:8080'],
    modelPrefixes: ['meta-llama', 'mistral', 'qwen'],
    badge: 'TGI',
    badgeClassName: 'bg-yellow-500 text-slate-950 dark:bg-yellow-300 dark:text-slate-950',
  },
  {
    id: 'sglang',
    label: 'SGLang',
    keywords: ['sglang', 'sgl'],
    hostnames: ['localhost:30000', '127.0.0.1:30000'],
    modelPrefixes: ['deepseek', 'llama', 'qwen'],
    badge: 'SGL',
    badgeClassName: 'bg-sky-900 text-white dark:bg-sky-200 dark:text-slate-950',
  },
  {
    id: 'xinference',
    label: 'Xinference',
    keywords: ['xinference', 'xorbits inference'],
    hostnames: ['localhost:9997', '127.0.0.1:9997'],
    modelPrefixes: ['bge', 'rerank'],
    badge: 'XI',
    badgeClassName: 'bg-emerald-800 text-white dark:bg-emerald-200 dark:text-slate-950',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    keywords: ['openai-compatible', 'compatible proxy', 'custom'],
    badge: 'C',
    badgeClassName: 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-950',
  },
  { id: 'meta', label: 'Meta', keywords: ['llama', 'meta'], logo: '/providers/meta.svg' },
  { id: 'minimax', label: 'MiniMax', keywords: ['minimax'], logo: '/providers/minimax.svg', invertInDark: true },
  { id: 'qwen', label: 'Qwen', keywords: ['qwen', 'dashscope'], logo: '/providers/qwen.svg' },
  { id: 'alibaba', label: 'Alibaba Cloud', keywords: ['alibaba'], logo: '/providers/alibaba.svg' },
  { id: 'moonshot', label: 'Moonshot AI', keywords: ['moonshot', 'kimi'], logo: '/providers/moonshot.svg' },
  { id: 'nvidia', label: 'NVIDIA', keywords: ['nvidia', 'nim'], logo: '/providers/nvidia.svg' },
  { id: 'cerebras', label: 'Cerebras', keywords: ['cerebras'], logo: '/providers/cerebras.svg', invertInDark: true },
  { id: 'zhipu', label: 'Zhipu AI', keywords: ['zhipu', 'glm', 'chatglm'], logo: '/providers/zhipu.svg' },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock', keywords: ['titan', 'bedrock', 'amazon'], logo: '/providers/amazon.svg' },
]

/** Map protocol to a default provider entry */
const PROTOCOL_FALLBACK: Record<string, string> = {
  messages: 'anthropic',
}

function normalize(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

function matchesHost(baseUrl: string, hostnames: string[] = []) {
  if (!baseUrl) return false

  const lower = baseUrl.toLowerCase()
  let hostname = lower

  try {
    hostname = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    // Keep raw lower-case value for partial local URLs or host fragments.
  }

  return hostnames.some((host) => lower.includes(host) || hostname.includes(host))
}

function hasKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword))
}

export function resolveProviderIdentity({
  nodeId,
  providerId,
  providerName,
  baseUrl,
  modelIds = [],
  tags = [],
  protocol,
}: Pick<NodeIconProps, 'nodeId' | 'providerId' | 'providerName' | 'baseUrl' | 'modelIds' | 'tags' | 'protocol'>): ProviderIdentity | null {
  const explicitIds = [providerId, nodeId].map(normalize).filter(Boolean)

  for (const id of explicitIds) {
    const exact = PROVIDER_REGISTRY.find((entry) => id === entry.id)
    if (exact) return exact
  }

  const url = normalize(baseUrl)
  const byHost = PROVIDER_REGISTRY.find((entry) => matchesHost(url, entry.hostnames))
  if (byHost) return byHost

  const identifiers = [providerId, nodeId, providerName, ...tags].map(normalize).filter(Boolean)
  for (const identifier of identifiers) {
    const byKeyword = PROVIDER_REGISTRY.find((entry) => hasKeyword(identifier, entry.keywords))
    if (byKeyword) return byKeyword
  }

  const modelHints = modelIds.map(normalize).filter(Boolean)
  for (const model of modelHints) {
    const byModelPrefix = PROVIDER_REGISTRY.find((entry) =>
      entry.modelPrefixes?.some((prefix) => model.startsWith(prefix.toLowerCase())),
    )
    if (byModelPrefix) return byModelPrefix
  }

  if (protocol && PROTOCOL_FALLBACK[protocol]) {
    return PROVIDER_REGISTRY.find((entry) => entry.id === PROTOCOL_FALLBACK[protocol]) || null
  }

  return null
}

/**
 * Displays a provider-specific logo icon for a node.
 * Automatically handles dark mode for monochrome logos via CSS filter inversion.
 * Falls back to a generic AI icon if no match is found.
 */
export function NodeIcon({
  nodeId,
  providerId,
  providerName,
  baseUrl,
  modelIds,
  tags,
  protocol,
  className,
  style,
}: NodeIconProps) {
  const { t } = useTranslation('nodes')
  const [imgError, setImgError] = useState(false)
  const provider = useMemo(
    () => resolveProviderIdentity({ nodeId, providerId, providerName, baseUrl, modelIds, tags, protocol }),
    [baseUrl, modelIds, nodeId, protocol, providerId, providerName, tags],
  )

  useEffect(() => {
    setImgError(false)
  }, [provider?.id])

  if (provider?.logo && !imgError) {
    return (
      <img
        src={provider.logo}
        alt={provider.label || nodeId || protocol || t('nodeIcon.alt')}
        className={cn(
          className,
          provider.invertInDark && 'dark:invert'
        )}
        style={{ ...style, objectFit: 'contain' }}
        draggable={false}
        onError={() => setImgError(true)}
      />
    )
  }

  if (provider?.badge) {
    const badgeStyle = style ? { ...style, color: undefined } : undefined

    return (
      <span
        aria-label={provider.label}
        title={provider.label}
        className={cn(
          'inline-flex select-none items-center justify-center rounded-md text-[10px] font-black leading-none',
          provider.badgeClassName,
          className,
        )}
        style={badgeStyle}
      >
        {provider.badge}
      </span>
    )
  }

  // Generic fallback — Sparkles icon
  return (
    <Sparkles
      className={cn('text-[var(--accent)]', className)}
      style={style}
    />
  )
}

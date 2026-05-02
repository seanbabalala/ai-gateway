import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NodeIconProps {
  /** Node ID (e.g. "gpt", "claude", "openai") — used for provider detection */
  nodeId?: string
  /** Protocol name — fallback when nodeId doesn't match a known provider */
  protocol?: string
  className?: string
  style?: CSSProperties
}

/**
 * Provider logo registry.
 * Each entry: [keywords to match, SVG path, needsInvert (true for monochrome dark logos)]
 *
 * Logos sourced from manifest project (MIT licensed).
 */
const PROVIDER_REGISTRY: { keywords: string[]; logo: string; invertInDark: boolean }[] = [
  // Monochrome dark logos — need inversion in dark mode
  { keywords: ['claude', 'anthropic'], logo: '/providers/anthropic.svg', invertInDark: true },
  { keywords: ['gpt', 'openai', 'o1-', 'o3-', 'o4-'], logo: '/providers/openai.svg', invertInDark: true },
  { keywords: ['grok', 'xai'], logo: '/providers/xai.svg', invertInDark: true },

  // Multi-color logos — look fine on any background
  { keywords: ['deepseek'], logo: '/providers/deepseek.svg', invertInDark: false },
  { keywords: ['gemini'], logo: '/providers/gemini.svg', invertInDark: false },
  { keywords: ['google'], logo: '/providers/google.svg', invertInDark: false },
  { keywords: ['mistral', 'mixtral', 'codestral', 'pixtral'], logo: '/providers/mistral.svg', invertInDark: false },
  { keywords: ['llama', 'meta'], logo: '/providers/meta.svg', invertInDark: false },
  { keywords: ['groq'], logo: '/providers/groq.svg', invertInDark: false },
  { keywords: ['minimax'], logo: '/providers/minimax.svg', invertInDark: true },
  { keywords: ['qwen', 'dashscope'], logo: '/providers/qwen.svg', invertInDark: false },
  { keywords: ['alibaba'], logo: '/providers/alibaba.svg', invertInDark: false },
  { keywords: ['moonshot', 'kimi'], logo: '/providers/moonshot.svg', invertInDark: false },
  { keywords: ['cohere', 'command-r'], logo: '/providers/cohere.svg', invertInDark: false },
  { keywords: ['azure'], logo: '/providers/azure.svg', invertInDark: false },
  { keywords: ['ollama'], logo: '/providers/ollama.svg', invertInDark: true },
  { keywords: ['nvidia', 'nim'], logo: '/providers/nvidia.svg', invertInDark: false },
  { keywords: ['openrouter'], logo: '/providers/openrouter.svg', invertInDark: true },
  { keywords: ['cerebras'], logo: '/providers/cerebras.svg', invertInDark: true },
  { keywords: ['zhipu', 'glm', 'chatglm'], logo: '/providers/zhipu.svg', invertInDark: false },
  { keywords: ['titan', 'bedrock', 'amazon'], logo: '/providers/amazon.svg', invertInDark: false },
]

/** Map protocol to a default provider entry */
const PROTOCOL_FALLBACK: Record<string, { logo: string; invertInDark: boolean }> = {
  chat_completions: { logo: '/providers/openai.svg', invertInDark: true },
  responses: { logo: '/providers/openai.svg', invertInDark: true },
  messages: { logo: '/providers/anthropic.svg', invertInDark: true },
}

function resolveProvider(nodeId?: string, protocol?: string): { logo: string; invertInDark: boolean } | null {
  if (nodeId) {
    const lower = nodeId.toLowerCase()
    for (const entry of PROVIDER_REGISTRY) {
      if (entry.keywords.some((kw) => lower.includes(kw))) {
        return entry
      }
    }
  }

  if (protocol && PROTOCOL_FALLBACK[protocol]) {
    return PROTOCOL_FALLBACK[protocol]
  }

  return null
}

/**
 * Displays a provider-specific logo icon for a node.
 * Automatically handles dark mode for monochrome logos via CSS filter inversion.
 * Falls back to a generic AI icon if no match is found.
 */
export function NodeIcon({ nodeId, protocol, className, style }: NodeIconProps) {
  const { t } = useTranslation('nodes')
  const [imgError, setImgError] = useState(false)
  const provider = resolveProvider(nodeId, protocol)

  if (provider && !imgError) {
    return (
      <img
        src={provider.logo}
        alt={nodeId ?? protocol ?? t('nodeIcon.alt')}
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

  // Generic fallback — Sparkles icon
  return (
    <Sparkles
      className={cn('text-[var(--accent)]', className)}
      style={style}
    />
  )
}

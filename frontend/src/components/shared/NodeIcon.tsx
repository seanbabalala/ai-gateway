import type { CSSProperties } from 'react'
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
  const provider = resolveProvider(nodeId, protocol)

  if (provider) {
    return (
      <img
        src={provider.logo}
        alt={nodeId ?? protocol ?? 'AI Provider'}
        className={cn(
          className,
          provider.invertInDark && 'dark:invert'
        )}
        style={{ ...style, objectFit: 'contain' }}
        draggable={false}
      />
    )
  }

  // Generic fallback — a simple AI icon
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm2.07-7.75l-.9.92C11.45 10.9 11 11.5 11 13h2v-.5l1.17-1.21c.4-.41.83-.86.83-1.79 0-1.38-1.12-2.5-2.5-2.5S10 8.12 10 9.5h2c0-.55.45-1 1-1s1 .45 1 1-.2.68-.93 1.25z"
        fill="currentColor"
      />
    </svg>
  )
}

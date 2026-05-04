import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, Check, Sparkles } from 'lucide-react'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { Badge } from '@/components/ui/badge'
import { getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { NodeInfo } from '@/types/api'

interface QuickModelReferenceProps {
  nodes: NodeInfo[]
}

function modelIdsForNode(node: NodeInfo): string[] {
  return Array.from(new Set([
    ...node.models,
    ...(node.embedding_models || []),
    ...(node.rerank_models || []),
    ...(node.image_models || []),
    ...(node.audio_models || []),
    ...(node.video_models || []),
    ...(node.realtime_models || []),
    ...(node.realtime?.models || []),
  ]))
}

export function QuickModelReference({ nodes }: QuickModelReferenceProps) {
  const { t } = useTranslation('nodes')
  const [expanded, setExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(text)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  return (
    <div className="rounded-lg bg-[var(--glass-bg)] shadow-[var(--card-shadow)]">
      {/* Toggle Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="matrix-row flex w-full items-center justify-between rounded-lg px-5 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">
            {t('quickReference.title')}
          </span>
          <span className="text-[11px] text-[var(--foreground-dim)]">
            &mdash; {t('quickReference.subtitle')}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[var(--foreground-dim)]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--foreground-dim)]" />
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-5 pb-4 pt-3">
          {/* Auto (Smart Routing) */}
          <div className="mb-3">
            <CopyableId
              text="auto"
              label={t('quickReference.smartRouting')}
              isCopied={copiedId === 'auto'}
              onCopy={copyToClipboard}
              copyTitle={t('quickReference.copyTitle', { value: 'auto' })}
              copiedLabel={t('quickReference.copied')}
              accent
            />
          </div>

          {/* Per-node model lists */}
          <div className="space-y-3">
            {nodes.map((node) => (
              <div key={node.id}>
                {/* Node header */}
                <div className="mb-1.5 flex items-center gap-2">
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: colorWithOpacity(getNodeColor(node.id), '15'),
                    }}
                  >
                    <NodeIcon
                      nodeId={node.id}
                      providerName={node.name}
                      baseUrl={node.base_url}
                      modelIds={modelIdsForNode(node)}
                      tags={node.tags}
                      protocol={node.protocol}
                      className="h-3 w-3"
                      style={{ color: getNodeColor(node.id) }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
                    {node.name}
                  </span>
                </div>

                {/* Models */}
                <div className="ml-7 flex flex-wrap gap-1.5">
                  {node.models.map((model) => (
                    <CopyableId
                      key={model}
                      text={model}
                      isCopied={copiedId === model}
                      onCopy={copyToClipboard}
                      copyTitle={t('quickReference.copyTitle', { value: model })}
                      copiedLabel={t('quickReference.copied')}
                    />
                  ))}

                  {/* Aliases */}
                  {Object.entries(node.aliases).map(([alias, target]) => (
                    <CopyableId
                      key={alias}
                      text={alias}
                      suffix={`\u2192 ${target}`}
                      isCopied={copiedId === alias}
                      onCopy={copyToClipboard}
                      copyTitle={t('quickReference.copyTitle', { value: alias })}
                      copiedLabel={t('quickReference.copied')}
                      muted
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Copyable ID chip ──

function CopyableId({
  text,
  label,
  suffix,
  isCopied,
  onCopy,
  copyTitle,
  copiedLabel,
  accent,
  muted,
}: {
  text: string
  label?: string
  suffix?: string
  isCopied: boolean
  onCopy: (text: string) => void
  copyTitle: string
  copiedLabel: string
  accent?: boolean
  muted?: boolean
}) {
  return (
    <button
      onClick={() => onCopy(text)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] transition-all duration-200 ${
        accent
          ? 'bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--background-tertiary)]'
          : muted
            ? 'bg-[var(--inset-bg)] text-[var(--foreground-dim)] hover:text-[var(--foreground-muted)] hover:bg-[var(--background-tertiary)]'
            : 'bg-[var(--inset-bg)] text-[var(--foreground-muted)] hover:bg-[var(--accent-muted)] hover:text-[var(--foreground)]'
      }`}
      title={copyTitle}
    >
      {isCopied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 opacity-40" />
      )}
      <span>{label || text}</span>
      {suffix && (
        <span className="text-[var(--foreground-dim)] text-[9px]">{suffix}</span>
      )}
      {isCopied && (
        <Badge variant="gold" className="ml-1 text-[9px] px-1.5 py-0">
          {copiedLabel}
        </Badge>
      )}
    </button>
  )
}

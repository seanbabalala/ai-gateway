import { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, Sparkles } from 'lucide-react'
import { NodeIcon } from '@/components/shared/NodeIcon'
import { Badge } from '@/components/ui/badge'
import { getNodeColor } from '@/lib/utils'
import { colorWithOpacity } from '@/lib/theme'
import type { NodeInfo } from '@/types/api'

interface QuickModelReferenceProps {
  nodes: NodeInfo[]
}

export function QuickModelReference({ nodes }: QuickModelReferenceProps) {
  const [expanded, setExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(text)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background-secondary)]">
      {/* Toggle Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">
            Quick Model Reference
          </span>
          <span className="text-xs text-[var(--foreground-dim)]">
            &mdash; Click any model ID to copy
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
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
          {/* Auto (Smart Routing) */}
          <div className="mb-3">
            <CopyableId
              text="auto"
              label="Smart Routing"
              isCopied={copiedId === 'auto'}
              onCopy={copyToClipboard}
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
                    className="flex h-5 w-5 items-center justify-center rounded"
                    style={{
                      backgroundColor: colorWithOpacity(getNodeColor(node.id), '20'),
                    }}
                  >
                    <NodeIcon
                      nodeId={node.id}
                      protocol={node.protocol}
                      className="h-3 w-3"
                      style={{ color: getNodeColor(node.id) }}
                    />
                  </div>
                  <span className="text-xs font-medium text-[var(--foreground-muted)]">
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
  accent,
  muted,
}: {
  text: string
  label?: string
  suffix?: string
  isCopied: boolean
  onCopy: (text: string) => void
  accent?: boolean
  muted?: boolean
}) {
  return (
    <button
      onClick={() => onCopy(text)}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono transition-colors ${
        accent
          ? 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
          : muted
            ? 'bg-[var(--background-tertiary)] text-[var(--foreground-dim)] hover:text-[var(--foreground-muted)] hover:bg-[var(--border)]'
            : 'bg-[var(--background-tertiary)] text-[var(--foreground-muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]'
      }`}
      title={`Click to copy: ${text}`}
    >
      {isCopied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 opacity-40" />
      )}
      <span>{label || text}</span>
      {suffix && (
        <span className="text-[var(--foreground-dim)] text-[10px]">{suffix}</span>
      )}
      {isCopied && (
        <Badge variant="default" className="ml-1 text-[9px] px-1 py-0">
          Copied!
        </Badge>
      )}
    </button>
  )
}

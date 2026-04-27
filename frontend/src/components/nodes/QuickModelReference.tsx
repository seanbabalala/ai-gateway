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
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--glass-bg)] backdrop-blur-sm">
      {/* Toggle Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[var(--inset-bg)] rounded-2xl"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">
            Quick Model Reference
          </span>
          <span className="text-[11px] text-[var(--foreground-dim)]">
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
        <div className="border-t border-[var(--border)] px-5 pb-4 pt-3">
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
                    className="flex h-5 w-5 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: colorWithOpacity(getNodeColor(node.id), '15'),
                    }}
                  >
                    <NodeIcon
                      nodeId={node.id}
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] transition-all duration-200 ${
        accent
          ? 'bg-[var(--accent-muted)] text-[var(--accent)] hover:shadow-[0_0_12px_var(--accent-glow)]'
          : muted
            ? 'bg-[var(--inset-bg)] text-[var(--foreground-dim)] hover:text-[var(--foreground-muted)] hover:bg-[var(--background-tertiary)]'
            : 'bg-[var(--inset-bg)] text-[var(--foreground-muted)] hover:bg-[var(--background-tertiary)] hover:text-[var(--foreground)]'
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
        <span className="text-[var(--foreground-dim)] text-[9px]">{suffix}</span>
      )}
      {isCopied && (
        <Badge variant="gold" className="ml-1 text-[9px] px-1.5 py-0">
          Copied!
        </Badge>
      )}
    </button>
  )
}

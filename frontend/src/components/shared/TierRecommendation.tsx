// ===================================================================
// TierRecommendation — Real-time tier suitability display
// ===================================================================
// Shows which tiers best match the selected capabilities.
// Computed locally using the same affinity matrix as the backend.
// ===================================================================

import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { CAPABILITY_MAP } from '@/lib/capabilities'

interface TierRecommendationProps {
  capabilities: string[]
}

interface TierScore {
  tier: string
  score: number
  suitable: boolean
  label: string
}

function computeTierScores(capabilities: string[]): TierScore[] {
  const validCaps = capabilities.filter((c) => CAPABILITY_MAP[c])
  if (validCaps.length === 0) return []

  const tiers = ['simple', 'standard', 'complex', 'reasoning'] as const

  // Tier affinity data mirroring backend capabilities.ts
  const affinityMap: Record<string, Record<string, number>> = {
    coding: { simple: 0, standard: 0.6, complex: 1.0, reasoning: 0.7 },
    coding_frontend: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.3 },
    coding_backend: { simple: 0, standard: 0.5, complex: 1.0, reasoning: 0.7 },
    reasoning: { simple: 0, standard: 0.2, complex: 0.7, reasoning: 1.0 },
    analysis: { simple: 0, standard: 0.4, complex: 0.8, reasoning: 0.9 },
    creative: { simple: 0.2, standard: 0.7, complex: 0.5, reasoning: 0.2 },
    long_context: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.6 },
    tool_use: { simple: 0, standard: 0.7, complex: 0.8, reasoning: 0.5 },
    fast: { simple: 1.0, standard: 0.3, complex: 0, reasoning: 0 },
    multilingual: { simple: 0.3, standard: 0.6, complex: 0.5, reasoning: 0.3 },
  }

  const results: TierScore[] = tiers.map((tier) => {
    let total = 0
    for (const capId of validCaps) {
      total += affinityMap[capId]?.[tier] ?? 0
    }
    const avg = Number((total / validCaps.length).toFixed(2))
    let label: string
    if (avg >= 0.7) label = 'Best fit'
    else if (avg >= 0.5) label = 'Good fit'
    else if (avg >= 0.3) label = 'Fallback only'
    else label = 'Not recommended'

    return { tier, score: avg, suitable: avg > 0.4, label }
  })

  results.sort((a, b) => b.score - a.score)
  return results
}

export function TierRecommendation({ capabilities }: TierRecommendationProps) {
  const scores = computeTierScores(capabilities)

  if (scores.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-4 py-3">
        <p className="text-[11px] text-[var(--foreground-dim)]">
          Select capabilities above to see tier recommendations
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] px-4 py-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--foreground-dim)]">
        Tier Recommendation
      </div>
      <div className="space-y-1.5">
        {scores.map((s) => (
          <div key={s.tier} className="flex items-center gap-2 text-[11px]">
            {s.score >= 0.7 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : s.score >= 0.3 ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            )}
            <span className="font-semibold text-[var(--foreground)] w-20">{s.tier}</span>
            <span className="font-mono text-[var(--foreground-dim)] w-10 text-right">
              {s.score.toFixed(2)}
            </span>
            <span className={`text-[10px] ${
              s.score >= 0.7
                ? 'text-emerald-600 dark:text-emerald-400'
                : s.score >= 0.3
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-[var(--foreground-dim)]'
            }`}>
              — {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

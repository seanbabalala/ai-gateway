// ===================================================================
// CapabilityPicker — Multi-select capability chips
// ===================================================================

import { CAPABILITIES } from '@/lib/capabilities'
import { useTranslation } from 'react-i18next'

interface CapabilityPickerProps {
  selected: string[]
  onChange: (capabilities: string[]) => void
}

export function CapabilityPicker({ selected, onChange }: CapabilityPickerProps) {
  const { t } = useTranslation('nodes')
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((c) => c !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CAPABILITIES.map((cap) => {
        const Icon = cap.icon
        const isSelected = selected.includes(cap.id)

        return (
          <button
            key={cap.id}
            type="button"
            onClick={() => toggle(cap.id)}
            className={`
              inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5
              text-[11px] font-semibold transition-all duration-200
              border cursor-pointer select-none
              ${
                isSelected
                  ? `${cap.bgClass} ${cap.borderClass} ${cap.textClass} shadow-sm`
                  : 'bg-transparent border-[var(--border)] text-[var(--foreground-dim)] hover:border-[var(--foreground-muted)] hover:text-[var(--foreground-muted)]'
              }
            `}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(`capabilities.${cap.id}`, { defaultValue: cap.label.en })}</span>
          </button>
        )
      })}
    </div>
  )
}

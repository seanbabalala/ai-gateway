import { useState } from 'react'
import { Check, Clipboard, FileCode2, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface SetupGuideStatus {
  label: string
  value: string
  tone?: BadgeProps['variant']
}

export interface SetupGuidePanelProps {
  title: string
  description: string
  icon?: LucideIcon
  statuses: SetupGuideStatus[]
  bullets: string[]
  snippetTitle: string
  snippet: string
  className?: string
}

export function SetupGuidePanel({
  title,
  description,
  icon: Icon = FileCode2,
  statuses,
  bullets,
  snippetTitle,
  snippet,
  className,
}: SetupGuidePanelProps) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)

  const copySnippet = () => {
    void navigator.clipboard.writeText(snippet)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <CardStatic className={className}>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <p className="mt-1 max-w-4xl text-[12px] font-medium leading-5 text-[var(--foreground-dim)]">
              {description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => (
            <Badge key={`${status.label}:${status.value}`} variant={status.tone || 'zinc'} className="gap-1.5 whitespace-nowrap">
              <span className="text-[var(--foreground-dim)]">{status.label}</span>
              <span>{status.value}</span>
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {bullets.map((bullet) => (
              <div
                key={bullet}
                className="flex min-h-[48px] items-start gap-2 rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] font-medium leading-5 text-[var(--foreground-dim)]"
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{bullet}</span>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--inset-bg)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
              <div className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                {snippetTitle}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={copySnippet} className="h-7 shrink-0 px-2">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                <span className="max-w-[88px] truncate">{copied ? t('setupGuide.copied') : t('setupGuide.copy')}</span>
              </Button>
            </div>
            <pre
              className={cn(
                'max-h-[360px] overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-5 text-[var(--foreground-muted)]',
              )}
            >
              {snippet}
            </pre>
          </div>
        </div>
      </CardContent>
    </CardStatic>
  )
}

import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  children?: ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-2 flex items-start justify-between">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[var(--foreground)]">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] text-[var(--foreground-dim)]">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 pt-1">{children}</div>}
    </div>
  )
}

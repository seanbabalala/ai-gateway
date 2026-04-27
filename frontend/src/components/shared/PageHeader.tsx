interface PageHeaderProps {
  title: string
  description?: string
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-2">
      <h1 className="text-[28px] font-bold tracking-tight text-[var(--foreground)]">{title}</h1>
      {description && (
        <p className="mt-1 text-[13px] text-[var(--foreground-dim)]">{description}</p>
      )}
    </div>
  )
}

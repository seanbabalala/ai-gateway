interface PageHeaderProps {
  title: string
  description?: string
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-[var(--foreground-dim)]">{description}</p>
      )}
    </div>
  )
}

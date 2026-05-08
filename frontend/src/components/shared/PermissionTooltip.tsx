import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/ui/tooltip'
import type { WorkspaceRole } from '@/types/api'

interface PermissionTooltipProps {
  allowed: boolean
  requiredRole: WorkspaceRole
  children: ReactNode
}

export function PermissionTooltip({
  allowed,
  requiredRole,
  children,
}: PermissionTooltipProps) {
  const { t } = useTranslation('common')
  if (allowed) return <>{children}</>
  return (
    <Tooltip
      content={t('rbac.denied.tooltip', {
        role: t(`rbac.roles.${requiredRole}`),
      })}
      side="top"
    >
      <span className="inline-flex">{children}</span>
    </Tooltip>
  )
}

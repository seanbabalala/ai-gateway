import { ShieldCheck, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardStatic, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { useUpdateWorkspaceMember, useWorkspaceMembers } from '@/hooks/use-members'
import { hasWorkspaceRole, useWorkspaces } from '@/hooks/use-workspaces'
import { formatDate } from '@/lib/utils'
import type { WorkspaceRole } from '@/types/api'

const roleVariants: Record<WorkspaceRole, 'emerald' | 'blue' | 'zinc'> = {
  admin: 'emerald',
  operator: 'blue',
  viewer: 'zinc',
}

export function MembersPage() {
  const { t } = useTranslation('common')
  const { data: workspaceState } = useWorkspaces()
  const canAdmin = hasWorkspaceRole(workspaceState?.access, 'admin')
  const members = useWorkspaceMembers(canAdmin)
  const updateMember = useUpdateWorkspaceMember()

  if (!canAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('members.title')}
          description={t('members.description')}
          icon={ShieldCheck}
          badge={<Badge variant="zinc">{t('rbac.roles.viewer')}</Badge>}
        />
        <CardStatic>
          <EmptyState
            icon={ShieldCheck}
            title={t('rbac.denied.title')}
            description={t('rbac.denied.adminMembers')}
          />
        </CardStatic>
      </div>
    )
  }

  if (members.isError) {
    return <ErrorState error={members.error} onRetry={members.refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('members.title')}
        description={t('members.description')}
        icon={ShieldCheck}
        badge={
          <Badge variant={roleVariants[workspaceState?.access?.role || 'viewer']}>
            {t(`rbac.roles.${workspaceState?.access?.role || 'viewer'}`)}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(['admin', 'operator', 'viewer'] as WorkspaceRole[]).map((role) => {
          const count = members.data?.items.filter((member) => member.role === role && member.status === 'active').length || 0
          return (
            <CardStatic key={role}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <Badge variant={roleVariants[role]}>{t(`rbac.roles.${role}`)}</Badge>
                  <UsersRound className="h-4 w-4 text-[var(--foreground-dim)]" />
                </div>
                <div className="mt-3 text-3xl font-extrabold text-[var(--foreground)]">{count}</div>
                <p className="mt-1 text-[12px] leading-5 text-[var(--foreground-dim)]">
                  {t(`rbac.roleDescriptions.${role}`)}
                </p>
              </CardContent>
            </CardStatic>
          )
        })}
      </div>

      <CardStatic>
        <CardHeader>
          <CardTitle>{t('members.table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {members.isLoading ? (
            <SkeletonTable rows={3} cols={5} />
          ) : members.data?.items.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={t('members.empty.title')}
              description={t('members.empty.description')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('members.table.identity')}</TableHead>
                  <TableHead>{t('members.table.role')}</TableHead>
                  <TableHead>{t('members.table.status')}</TableHead>
                  <TableHead>{t('members.table.created')}</TableHead>
                  <TableHead>{t('members.table.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data?.items.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-semibold text-[var(--foreground)]">{member.user_id}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--foreground-dim)]">{member.id}</div>
                    </TableCell>
                    <TableCell>
                      <Tooltip content={t(`rbac.roleDescriptions.${member.role}`)}>
                        <div className="inline-flex">
                          <Select
                            value={member.role}
                            options={(['admin', 'operator', 'viewer'] as WorkspaceRole[]).map((role) => ({
                              value: role,
                              label: t(`rbac.roles.${role}`),
                            }))}
                            onChange={(role) =>
                              updateMember.mutate({
                                id: member.id,
                                role: role as WorkspaceRole,
                              })
                            }
                            className="w-36"
                          />
                        </div>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.status === 'active' ? 'emerald' : 'zinc'}>
                        {t(`members.status.${member.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {formatDate(member.created_at)}
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--foreground-muted)]">
                      {formatDate(member.updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </CardStatic>
    </div>
  )
}

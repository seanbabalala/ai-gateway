import { IsNull } from 'typeorm';
import { DEFAULT_WORKSPACE_ID } from './workspace.constants';

export function normalizeWorkspaceId(value: string | null | undefined): string {
  const normalized = (value || '').trim();
  return normalized || DEFAULT_WORKSPACE_ID;
}

export function workspaceFindWhere<T extends Record<string, unknown>>(
  workspaceId: string | null | undefined,
  where: T,
): T | T[] {
  const normalized = normalizeWorkspaceId(workspaceId);
  if (normalized !== DEFAULT_WORKSPACE_ID) {
    return { ...where, workspace_id: normalized } as T;
  }
  return [
    { ...where, workspace_id: normalized },
    { ...where, workspace_id: IsNull() },
  ] as T[];
}

export function workspaceFindWhereStrict<T extends Record<string, unknown>>(
  workspaceId: string | null | undefined,
  where: T,
): T {
  return { ...where, workspace_id: normalizeWorkspaceId(workspaceId) } as T;
}

export function applyWorkspaceQueryScope<
  T extends { where: Function; andWhere: Function },
>(
  qb: T,
  alias: string,
  workspaceId: string | null | undefined,
  method: 'where' | 'andWhere' = 'andWhere',
): T {
  const normalized = normalizeWorkspaceId(workspaceId);
  if (normalized === DEFAULT_WORKSPACE_ID) {
    qb[method](
      `(${alias}.workspace_id = :workspaceId OR ${alias}.workspace_id IS NULL)`,
      { workspaceId: normalized },
    );
    return qb;
  }
  qb[method](`${alias}.workspace_id = :workspaceId`, { workspaceId: normalized });
  return qb;
}

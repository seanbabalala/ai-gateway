import { getAuthToken, clearAuthToken } from '@/contexts/AuthContext'
import { i18n } from '@/i18n'

export const workspaceStorageKey = 'siftgate-active-workspace-id'
export const workspaceHeader = 'x-siftgate-workspace-id'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function authHeaders(): Record<string, string> {
  const workspaceId = getActiveWorkspaceId()
  const headers: Record<string, string> = workspaceId
    ? { [workspaceHeader]: workspaceId }
    : {}
  const token = getAuthToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export function getActiveWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(workspaceStorageKey)
  } catch {
    return null
  }
}

export function setActiveWorkspaceId(workspaceId: string): void {
  try {
    window.localStorage.setItem(workspaceStorageKey, workspaceId)
  } catch {
    // localStorage can be unavailable in hardened browsers; requests will fall back server-side.
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // Token expired or invalid — clear and redirect to login
    clearAuthToken()
    window.location.href = '/login'
    throw new ApiError(401, i18n.t('error.unauthorized'))
  }
  if (!res.ok) {
    const text = await res.text().catch(() => i18n.t('error.unknown'))
    throw new ApiError(res.status, text)
  }
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }
  const res = await fetch(url.toString(), {
    headers: { ...authHeaders() },
  })
  return handleResponse<T>(res)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  return handleResponse<T>(res)
}

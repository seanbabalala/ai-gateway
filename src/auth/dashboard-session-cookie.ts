import type { Response } from 'express';

export const DASHBOARD_SESSION_COOKIE = 'siftgate_dashboard_session';
export const DASHBOARD_SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DashboardSessionCookieRequest {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

function secureCookieEnabled(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setDashboardSessionCookie(
  res: Response | undefined,
  token: string,
): void {
  if (!res || !token) return;
  res.cookie(DASHBOARD_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieEnabled(),
    path: '/',
    maxAge: DASHBOARD_SESSION_COOKIE_MAX_AGE_MS,
  });
}

export function clearDashboardSessionCookie(res: Response | undefined): void {
  if (!res) return;
  res.clearCookie(DASHBOARD_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieEnabled(),
    path: '/',
  });
}

export function getDashboardSessionCookie(
  request: DashboardSessionCookieRequest | undefined,
): string | null {
  const parsedCookie = request?.cookies?.[DASHBOARD_SESSION_COOKIE];
  if (parsedCookie) return parsedCookie;
  return extractCookieToken(headerValue(request?.headers?.cookie));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.split('=');
    if (rawName.trim() !== DASHBOARD_SESSION_COOKIE) continue;
    const value = rawValue.join('=').trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

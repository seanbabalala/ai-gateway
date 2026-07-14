import type { Response } from 'express';

export const DASHBOARD_SESSION_COOKIE = 'siftgate_dashboard_session';
export const DASHBOARD_SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

import type { ApiErrorResponse } from '@erp/shared';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Hooks installed by the auth store (kept as injectable callbacks to avoid an import cycle).
 * - accessToken: current in-memory access token (never persisted).
 * - refresh: renew the access token via the httpOnly refresh cookie; resolves false on failure.
 * - onUnauthenticated: session is gone (e.g. revoked) — clear state and go to the login page.
 */
export interface AuthHooks {
  accessToken: () => string | null;
  refresh: () => Promise<boolean>;
  onUnauthenticated: () => void;
}

let hooks: AuthHooks | null = null;
export function installAuthHooks(h: AuthHooks) {
  hooks = h;
}

/**
 * Low-level request: JSON in/out (or multipart when the body is FormData — the browser sets the
 * boundary), cookies included (refresh cookie), no retry.
 */
export async function rawFetch<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'HTTP_ERROR',
      body?.error.message ?? res.statusText,
      body?.error.details,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * Authenticated API call. On 401 TOKEN_EXPIRED the access token is refreshed once and the
 * request retried; any other 401 ends the session. The tenant is never sent by the client —
 * the server derives it from the session.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, init, hooks?.accessToken());
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !hooks) throw err;
    if (err.code === 'TOKEN_EXPIRED' && (await hooks.refresh())) {
      return rawFetch<T>(path, init, hooks.accessToken());
    }
    hooks.onUnauthenticated();
    throw err;
  }
}

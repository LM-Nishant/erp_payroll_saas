import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const limited = () => json(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
const ok = () => json(200, { data: { accessToken: 'new-token' } });
const me = () =>
  json(200, { data: { user: { id: 'u1', name: 'U', email: 'u@x' }, permissions: [] } });

describe('auth store refresh', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

  it('retries a rate-limited refresh instead of signing out', async () => {
    fetchMock
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(me());
    const auth = useAuthStore();
    const done = auth.refresh();
    await vi.runAllTimersAsync();
    expect(await done).toBe(true);
    expect(auth.accessToken).toBe('new-token');
    expect(urls().filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(3);
  });

  it('signs out without retrying when the refresh token is rejected', async () => {
    fetchMock.mockResolvedValue(
      json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired' } }),
    );
    const auth = useAuthStore();
    const done = auth.refresh();
    await vi.runAllTimersAsync();
    expect(await done).toBe(false);
    expect(auth.accessToken).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after repeated rate limiting', async () => {
    fetchMock.mockImplementation(async () => limited());
    const auth = useAuthStore();
    const done = auth.refresh();
    await vi.runAllTimersAsync();
    expect(await done).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

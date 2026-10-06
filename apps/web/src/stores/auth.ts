import type { LoginResult, MeResponse } from '@erp/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, installAuthHooks, rawFetch } from '@/api/client';

type Data<T> = { data: T };

export type LoginOutcome =
  | { status: 'ok' }
  | { status: 'mfa' }
  | { status: 'select-organization'; organizations: Array<{ slug: string; name: string }> };

/**
 * Auth store. The access token lives only in memory; the refresh token is an httpOnly,
 * SameSite=Strict cookie scoped to /api/v1/auth (tokenDelivery: 'cookie'), so a page reload
 * restores the session via /auth/refresh. Permissions come from /me and drive menus/guards —
 * the backend enforces them regardless.
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const me = ref<MeResponse | null>(null);
  const mfaToken = ref<string | null>(null);
  const initialized = ref(false);
  let refreshing: Promise<boolean> | null = null;

  const isAuthenticated = computed(() => Boolean(accessToken.value && me.value));
  const permissions = computed(() => new Set(me.value?.permissions ?? []));
  const can = computed(
    () => (permission?: string) => !permission || permissions.value.has(permission),
  );
  const isPlatformUser = computed(() => (me.value?.platformRoles.length ?? 0) > 0);

  async function loadMe() {
    me.value = (await rawFetch<Data<MeResponse>>('/api/v1/me', {}, accessToken.value)).data;
  }

  async function acceptTokens(result: LoginResult) {
    accessToken.value = result.accessToken ?? null;
    mfaToken.value = null;
    await loadMe();
  }

  async function login(
    email: string,
    password: string,
    organization?: string,
  ): Promise<LoginOutcome> {
    try {
      const { data } = await rawFetch<Data<LoginResult>>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, organization, tokenDelivery: 'cookie' }),
      });
      if (data.mfaRequired) {
        mfaToken.value = data.mfaToken ?? null;
        return { status: 'mfa' };
      }
      await acceptTokens(data);
      return { status: 'ok' };
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ORGANIZATION_SELECTION_REQUIRED') {
        const details = err.details as { organizations?: Array<{ slug: string; name: string }> };
        return { status: 'select-organization', organizations: details?.organizations ?? [] };
      }
      throw err;
    }
  }

  async function verifyMfa(input: { code?: string; recoveryCode?: string }) {
    const { data } = await rawFetch<Data<LoginResult>>('/api/v1/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ mfaToken: mfaToken.value, ...input }),
    });
    await acceptTokens(data);
  }

  /** Single-flight refresh using the httpOnly cookie. */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const { data } = await rawFetch<Data<LoginResult>>('/api/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        accessToken.value = data.accessToken ?? null;
        if (!me.value) await loadMe();
        return true;
      } catch {
        clear();
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** Restore a session on first navigation (page reload). */
  async function init() {
    if (initialized.value) return;
    initialized.value = true;
    await refresh();
  }

  function clear() {
    accessToken.value = null;
    me.value = null;
    mfaToken.value = null;
  }

  async function logout() {
    try {
      await rawFetch(
        '/api/v1/auth/logout',
        { method: 'POST', body: JSON.stringify({}) },
        accessToken.value,
      );
    } finally {
      clear();
    }
  }

  return {
    accessToken,
    me,
    mfaToken,
    initialized,
    isAuthenticated,
    isPlatformUser,
    can,
    login,
    verifyMfa,
    refresh,
    init,
    logout,
    clear,
    loadMe,
  };
});

/** Wire the API client to the auth store (called once at startup). */
export function connectApiClient(onUnauthenticated: () => void) {
  const auth = useAuthStore();
  installAuthHooks({
    accessToken: () => auth.accessToken,
    refresh: () => auth.refresh(),
    onUnauthenticated: () => {
      auth.clear();
      onUnauthenticated();
    },
  });
}

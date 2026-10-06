import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopeType } from '@erp/shared';
import { UnauthenticatedError } from '../http/errors';

/** A scope a grant applies to; `id` is null only for ORGANIZATION. */
export interface ScopeRef {
  type: ScopeType;
  id: string | null;
}

/** One role assignment: its permissions apply within its scopes. */
export interface Grant {
  roleKey: string;
  permissions: ReadonlySet<string>;
  scopes: readonly ScopeRef[];
}

/**
 * - `user`: a tenant user authenticated by JWT.
 * - `platform`: a platform admin inside an audited tenant-access session.
 * - `dev`: X-Dev-Organization header principal (dev/test only, refused in production).
 * - `system`: trusted server code (seeds, jobs).
 * - `api_client`: a machine client (OAuth2 client credentials, core/integrations); its grants
 *   are the client's API scopes within the client's hierarchy target.
 */
export type ActorType = 'user' | 'platform' | 'dev' | 'system' | 'api_client';

export interface Principal {
  readonly actorType: ActorType;
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly organizationId: string | null;
  readonly platformRoles: readonly string[];
  readonly platformPermissions: ReadonlySet<string>;
  /** Reason recorded when the platform tenant-access session was opened. */
  readonly platformAccessReason: string | null;
  readonly grants: readonly Grant[];
  /** Set for `api_client` principals. */
  readonly apiClientId?: string | null;
  /** Per-request memo for expanded scope sets (see engine.ts). */
  readonly cache: Map<string, unknown>;
}

export function createPrincipal(
  init: Omit<
    Principal,
    'cache' | 'platformRoles' | 'platformPermissions' | 'platformAccessReason'
  > &
    Partial<Pick<Principal, 'platformRoles' | 'platformPermissions' | 'platformAccessReason'>>,
): Principal {
  return {
    platformRoles: [],
    platformPermissions: new Set(),
    platformAccessReason: null,
    ...init,
    cache: new Map(),
  };
}

const storage = new AsyncLocalStorage<Principal>();

export function runWithPrincipal<T>(principal: Principal, fn: () => T): T {
  return storage.run(principal, fn);
}

/** Run `fn` with no principal (used by the queue to start jobs in a fresh context). */
export function exitPrincipal<T>(fn: () => T): T {
  return storage.exit(fn);
}

export function tryGetPrincipal(): Principal | undefined {
  return storage.getStore();
}

/** The authenticated principal of the current request. Throws 401 if there is none. */
export function currentPrincipal(): Principal {
  const principal = storage.getStore();
  if (!principal) throw new UnauthenticatedError();
  return principal;
}

/** Distinct permission codes the principal holds in at least one scope. */
export function effectivePermissions(principal: Principal): string[] {
  const codes = new Set<string>(principal.platformPermissions);
  for (const grant of principal.grants) for (const code of grant.permissions) codes.add(code);
  return [...codes].sort();
}

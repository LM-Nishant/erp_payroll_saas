import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantContextMissingError, TenantIsolationError } from './errors';

/**
 * Where the tenant context came from.
 * - `request`: resolved server-side for an HTTP request by a TenantResolver.
 * - `system`: explicitly established by trusted server code (seeds, jobs, workers).
 */
export type TenantContextSource = 'request' | 'system';

export interface TenantContext {
  readonly organizationId: string;
  readonly source: TenantContextSource;
  /** Authenticated principal id, populated by the auth layer (Layer 2). */
  readonly actorId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given tenant context. Nested calls may not switch to a different
 * organization — this prevents accidental tenant hopping inside a request.
 */
export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  const current = storage.getStore();
  if (current && current.organizationId !== context.organizationId) {
    throw new TenantIsolationError('Cannot switch tenant inside an active tenant context');
  }
  return storage.run(Object.freeze({ ...context }), fn);
}

export function tryGetTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new TenantContextMissingError();
  return context;
}

export function currentOrganizationId(): string {
  return getTenantContext().organizationId;
}

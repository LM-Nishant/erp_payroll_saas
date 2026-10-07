import { exitPrincipal, runWithPrincipal } from '../authz/principal';
import { systemPrincipal } from '../authz/loader';
import { exitTenantContext, runWithTenant } from '../tenancy/context';
import type { JobDefinition, JobRunInfo, TenantJobData } from './registry';

/**
 * Run a job handler in a FRESH context: tenant = the job's organization (source `system`),
 * principal = the system principal of that organization. Never inherits the caller's context.
 */
export function runJobInTenant(
  def: JobDefinition,
  data: TenantJobData,
  info: JobRunInfo,
): Promise<void> {
  if (!data || typeof data.organizationId !== 'string' || !data.organizationId) {
    return Promise.reject(new Error(`Job ${def.name} is missing organizationId`));
  }
  return exitTenantContext(() =>
    exitPrincipal(() =>
      runWithTenant({ organizationId: data.organizationId, source: 'system' }, () =>
        runWithPrincipal(systemPrincipal(data.organizationId), () => def.handler(data, info)),
      ),
    ),
  );
}

/** Run a platform-level function outside any tenant / principal context. */
export function runDetached<T>(fn: () => Promise<T>): Promise<T> {
  return exitTenantContext(() => exitPrincipal(fn));
}

/**
 * Run `fn` as the system principal inside `organizationId` (fresh context). Used by public
 * callbacks (provider delivery webhooks) after they have identified the tenant themselves.
 */
export function runAsSystem<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return exitTenantContext(() =>
    exitPrincipal(() =>
      runWithTenant({ organizationId, source: 'system' }, () =>
        runWithPrincipal(systemPrincipal(organizationId), fn),
      ),
    ),
  );
}

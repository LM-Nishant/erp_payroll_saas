import type { RequestHandler } from 'express';
import { UnauthenticatedError } from '../http/errors';
import { tryGetTenantContext } from '../tenancy/context';
import { buildPrincipal, devPrincipal } from './loader';
import { runWithPrincipal } from './principal';

/**
 * Builds the request Principal (roles, permissions, scopes) and runs the rest of the request
 * inside it so `currentPrincipal()` works in services.
 *
 * - Authenticated request (`req.auth`): principal from the session's roles/scopes.
 * - `allowDevPrincipal` (dev-header resolver only, never in production) and a tenant resolved
 *   from the X-Dev-Organization header: an all-permissions `dev` principal.
 * - Otherwise 401.
 */
export function principalContext(options: { allowDevPrincipal?: boolean } = {}): RequestHandler {
  return async (req, _res, next) => {
    let principal;
    if (req.auth) {
      principal = await buildPrincipal(req.auth);
    } else {
      const tenant = tryGetTenantContext();
      if (!options.allowDevPrincipal || !tenant) throw new UnauthenticatedError();
      principal = devPrincipal(tenant.organizationId);
    }
    runWithPrincipal(principal, () => next());
  };
}

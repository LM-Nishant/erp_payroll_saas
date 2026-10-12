import type { Request, RequestHandler } from 'express';
import { ForbiddenError } from '../http/errors';
import { authorize, assertPermission, hasPermission, type ResourceScope } from './engine';
import { currentPrincipal } from './principal';

export type ScopeResolver = (req: Request) => ResourceScope | Promise<ResourceScope>;

/**
 * Route guard. Without a scope resolver it checks the permission is held in ANY scope (the
 * service then scope-filters with `scopeWhere` / `authorize`). With a resolver it also checks
 * the resolved resource lies within the principal's scopes.
 */
export function requirePermission(
  permission: string,
  scopeResolver?: ScopeResolver,
): RequestHandler {
  return async (req, _res, next) => {
    const principal = currentPrincipal();
    if (scopeResolver) await authorize(principal, permission, await scopeResolver(req));
    else assertPermission(principal, permission);
    next();
  };
}

/**
 * Route guard passing when ANY of the permissions is held (in any scope); the service then
 * enforces the precise permission for the resource.
 */
export function requireAnyPermission(permissions: string[]): RequestHandler {
  return async (_req, _res, next) => {
    const principal = currentPrincipal();
    if (!permissions.some((p) => hasPermission(principal, p)))
      throw new ForbiddenError(
        `Missing permission: ${permissions.join(' or ')}`,
        'PERMISSION_DENIED',
      );
    next();
  };
}

/** Route guard for platform-level permissions (platform roles only). */
export function requirePlatformPermission(permission: string): RequestHandler {
  return (_req, _res, next) => {
    const principal = currentPrincipal();
    if (!principal.platformPermissions.has(permission)) {
      throw new ForbiddenError(`Missing platform permission "${permission}"`, 'PERMISSION_DENIED');
    }
    next();
  };
}

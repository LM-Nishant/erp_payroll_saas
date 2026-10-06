import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../http/errors';
import { runWithTenant } from './context';
import type { OrganizationLookup } from './organization-lookup';
import type { TenantResolver } from './resolver';

/** Keys that identify a tenant/hierarchy owner and must never come from the client. */
const FORBIDDEN_CLIENT_KEYS = new Set([
  'organizationId',
  'organization_id',
  'tenantId',
  'tenant_id',
]);

function hasForbiddenKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.keys(value).find((key) => FORBIDDEN_CLIENT_KEYS.has(key));
}

/** Defense in depth: reject tenant identifiers supplied in the body or query string. */
export const rejectClientTenantIdentifiers: RequestHandler = (req, _res, next) => {
  const key = hasForbiddenKey(req.body) ?? hasForbiddenKey(req.query);
  if (key) {
    next(new ValidationError(`"${key}" must not be supplied by the client`));
    return;
  }
  next();
};

/**
 * Resolves the TenantContext server-side and runs the rest of the request inside it.
 */
export function tenantContext(
  resolver: TenantResolver,
  lookup: OrganizationLookup,
): RequestHandler {
  return async (req, res, next) => {
    const resolution = await resolver.resolve(req);
    if (!resolution) {
      throw new UnauthenticatedError('Tenant could not be resolved', 'TENANT_UNRESOLVED');
    }
    const organization = await lookup.findById(resolution.organizationId);
    if (!organization) {
      throw new UnauthenticatedError('Tenant could not be resolved', 'TENANT_UNRESOLVED');
    }
    if (organization.status !== 'ACTIVE') {
      throw new ForbiddenError('Organization is not active', 'TENANT_INACTIVE');
    }
    res.locals.organizationId = organization.id;
    req.log = req.log?.child({ organizationId: organization.id });
    runWithTenant(
      { organizationId: organization.id, source: 'request', actorId: resolution.actorId },
      () => next(),
    );
  };
}

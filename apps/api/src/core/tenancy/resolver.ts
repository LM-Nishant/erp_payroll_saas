import type { Request } from 'express';
import type { OrganizationLookup } from './organization-lookup';

export interface TenantResolution {
  organizationId: string;
  actorId?: string;
}

/**
 * Resolves the tenant for a request from SERVER-SIDE trusted state only.
 *
 * Production uses `jwtTenantResolver`: the organization comes from the authenticated session
 * (`req.auth`, set by core/auth `authenticate` after verifying the access token and the live
 * session). Resolvers must never read tenant identifiers from the request body or query string.
 */
export interface TenantResolver {
  readonly name: string;
  resolve(req: Request): Promise<TenantResolution | null>;
}

/** Rejects every request: the safe default until an auth-backed resolver is configured. */
export const denyAllTenantResolver: TenantResolver = {
  name: 'none',
  resolve: async () => null,
};

export const DEV_TENANT_HEADER = 'x-dev-organization';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tenant is the organization bound to the authenticated session (JWT `org` claim). */
export const jwtTenantResolver: TenantResolver = {
  name: 'jwt',
  resolve: async (req) => {
    if (req.auth?.organizationId) {
      return { organizationId: req.auth.organizationId, actorId: req.auth.userId };
    }
    // Machine API client (verified client-credentials token): its own organization.
    if (req.apiClient) return { organizationId: req.apiClient.organizationId };
    return null;
  },
};

/**
 * DEVELOPMENT/TEST ONLY. Uses the JWT when present; otherwise trusts an `X-Dev-Organization`
 * header (org id or slug) and the request runs as an all-permissions `dev` principal.
 * Refused in production by env validation.
 */
export function devHeaderTenantResolver(lookup: OrganizationLookup): TenantResolver {
  return {
    name: 'dev-header',
    async resolve(req) {
      if (req.auth || req.apiClient) return jwtTenantResolver.resolve(req);
      const value = req.get(DEV_TENANT_HEADER)?.trim();
      if (!value) return null;
      const org = UUID.test(value) ? await lookup.findById(value) : await lookup.findBySlug(value);
      return org ? { organizationId: org.id } : null;
    },
  };
}

export function createTenantResolver(
  strategy: 'jwt' | 'dev-header' | 'none',
  lookup: OrganizationLookup,
): TenantResolver {
  if (strategy === 'jwt') return jwtTenantResolver;
  return strategy === 'dev-header' ? devHeaderTenantResolver(lookup) : denyAllTenantResolver;
}

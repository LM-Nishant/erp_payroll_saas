import type { Request } from 'express';
import type { OrganizationLookup } from './organization-lookup';

export interface TenantResolution {
  organizationId: string;
  actorId?: string;
}

/**
 * Resolves the tenant for a request from SERVER-SIDE trusted state only.
 *
 * Layer 1 ships a development stub. Layer 2 (auth) replaces it with a resolver that derives
 * the organization from the authenticated principal (JWT/session). Resolvers must never read
 * tenant identifiers from the request body or query string.
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

/**
 * DEVELOPMENT/TEST STUB ONLY. Trusts an `X-Dev-Organization` header (org id or slug).
 * Refused in production by env validation. Stands in for the authenticated principal.
 */
export function devHeaderTenantResolver(lookup: OrganizationLookup): TenantResolver {
  return {
    name: 'dev-header',
    async resolve(req) {
      const value = req.get(DEV_TENANT_HEADER)?.trim();
      if (!value) return null;
      const org = UUID.test(value) ? await lookup.findById(value) : await lookup.findBySlug(value);
      return org ? { organizationId: org.id } : null;
    },
  };
}

export function createTenantResolver(
  strategy: 'dev-header' | 'none',
  lookup: OrganizationLookup,
): TenantResolver {
  return strategy === 'dev-header' ? devHeaderTenantResolver(lookup) : denyAllTenantResolver;
}

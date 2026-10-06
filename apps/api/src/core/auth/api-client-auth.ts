import { isApiClientScopeAllowed, type SettingScopeType } from '@erp/shared';
import { prisma } from '../db/prisma';
import { UnauthenticatedError } from '../http/errors';
import { verifyClientToken } from './tokens';

/** Verified machine-client identity for a request (see core/integrations). */
export interface ApiClientAuth {
  apiClientId: string;
  clientId: string;
  organizationId: string;
  /** Effective scopes: token scopes ∩ the client's CURRENT scopes ∩ the API-allowed catalog. */
  scopes: string[];
  scopeType: SettingScopeType;
  targetId: string;
  rateLimitPerMinute: number;
}

/**
 * Verify a client access token AND that the client is still active (revocation, expiry and
 * scope removal take effect immediately, not at token expiry).
 */
export async function authenticateApiClientToken(token: string): Promise<ApiClientAuth> {
  const claims = await verifyClientToken(token);
  const client = await prisma.apiClient.findFirst({
    where: { id: claims.sub, organizationId: claims.org },
    include: {
      scopes: { select: { scope: true } },
      organization: { select: { status: true, deletedAt: true } },
    },
  });
  const now = new Date();
  if (
    !client ||
    client.status !== 'ACTIVE' ||
    (client.expiresAt && client.expiresAt <= now) ||
    client.organization.status !== 'ACTIVE' ||
    client.organization.deletedAt
  ) {
    throw new UnauthenticatedError('API client is no longer valid', 'SESSION_REVOKED');
  }
  const current = new Set(client.scopes.map((s) => s.scope));
  return {
    apiClientId: client.id,
    clientId: client.clientId,
    organizationId: client.organizationId,
    scopes: claims.scope.filter((s) => current.has(s) && isApiClientScopeAllowed(s)),
    scopeType: client.scopeType,
    targetId: client.targetId,
    rateLimitPerMinute: client.rateLimitPerMinute,
  };
}

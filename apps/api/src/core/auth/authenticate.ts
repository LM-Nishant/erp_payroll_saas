import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma';
import { UnauthenticatedError } from '../http/errors';
import type { AuthContext } from '../authz/loader';
import { authenticateApiClientToken, type ApiClientAuth } from './api-client-auth';
import { peekTokenType, verifyAccessToken } from './tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate` from a verified access token + live session. */
      auth?: AuthContext;
      /** Set by `authenticate({ allowApiClient })` for machine clients (core/integrations). */
      apiClient?: ApiClientAuth;
    }
  }
}

const TOUCH_INTERVAL_MS = 60_000;

export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

/**
 * Verifies the access token AND that its session is live (not revoked/expired), the user is
 * active and (for tenant sessions) the membership is still active. Revocation is therefore
 * effective immediately, not only at token expiry.
 */
export async function authenticateToken(token: string): Promise<AuthContext> {
  const claims = await verifyAccessToken(token);
  const session = await prisma.authSession.findUnique({
    where: { id: claims.sid },
    include: { user: { select: { status: true, deletedAt: true } } },
  });
  const now = new Date();
  if (
    !session ||
    session.userId !== claims.sub ||
    session.organizationId !== claims.org ||
    session.revokedAt ||
    session.expiresAt <= now
  ) {
    throw new UnauthenticatedError('Session is no longer valid', 'SESSION_REVOKED');
  }
  if (session.user.status !== 'ACTIVE' || session.user.deletedAt) {
    throw new UnauthenticatedError('Account is disabled', 'ACCOUNT_DISABLED');
  }
  if (session.organizationId && !session.platformAccessReason) {
    const membership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: { organizationId: session.organizationId, userId: session.userId },
      },
      select: { status: true, deletedAt: true },
    });
    if (!membership || membership.status !== 'ACTIVE' || membership.deletedAt) {
      throw new UnauthenticatedError('Organization access revoked', 'SESSION_REVOKED');
    }
  }
  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
  }
  return {
    userId: session.userId,
    sessionId: session.id,
    organizationId: session.organizationId,
    platformAccessReason: session.platformAccessReason,
  };
}

/**
 * Express middleware: requires (or, with `optional`, accepts) a ****** token. With
 * `allowApiClient`, a client-credentials access token (core/integrations) is also accepted and
 * sets `req.apiClient` instead of `req.auth`.
 */
export function authenticate(
  options: { optional?: boolean; allowApiClient?: boolean } = {},
): RequestHandler {
  return async (req, _res, next) => {
    if (req.auth || req.apiClient) return next();
    const token = bearerToken(req.get('authorization'));
    if (!token) {
      if (options.optional) return next();
      throw new UnauthenticatedError();
    }
    if (options.allowApiClient && peekTokenType(token) === 'client') {
      req.apiClient = await authenticateApiClientToken(token);
      return next();
    }
    req.auth = await authenticateToken(token);
    next();
  };
}

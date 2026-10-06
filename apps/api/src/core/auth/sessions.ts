import type { AuthSession } from '@prisma/client';
import { env } from '../config/env';
import { randomToken, sha256 } from '../crypto';
import { prisma } from '../db/prisma';
import { UnauthenticatedError } from '../http/errors';
import { currentRequestMeta } from '../http/request-context';
import { recordAudit } from '../audit/audit';
import { signAccessToken } from './tokens';

const DAY_MS = 86_400_000;

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Absent for sessions without refresh (platform tenant-access sessions). */
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}

export async function createSession(input: {
  userId: string;
  organizationId: string | null;
  mfaVerified: boolean;
  deviceName?: string | undefined;
  platformAccessReason?: string;
  expiresAt?: Date;
}): Promise<AuthSession> {
  const meta = currentRequestMeta();
  return prisma.authSession.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId,
      mfaVerified: input.mfaVerified,
      deviceName: input.deviceName ?? null,
      platformAccessReason: input.platformAccessReason ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    },
  });
}

async function createRefreshToken(sessionId: string) {
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  await prisma.refreshToken.create({ data: { sessionId, tokenHash: sha256(raw), expiresAt } });
  return { raw, expiresAt };
}

export async function issueTokens(
  session: AuthSession,
  options: { withRefresh: boolean },
): Promise<IssuedTokens> {
  const access = await signAccessToken({
    sub: session.userId,
    sid: session.id,
    org: session.organizationId,
  });
  // Never let an access token outlive its session (matters for short platform sessions).
  const accessTokenExpiresAt =
    access.expiresAt > session.expiresAt ? session.expiresAt : access.expiresAt;
  if (!options.withRefresh) {
    const ttl = Math.max(1, Math.floor((accessTokenExpiresAt.getTime() - Date.now()) / 1000));
    const limited = await signAccessToken(
      { sub: session.userId, sid: session.id, org: session.organizationId },
      ttl,
    );
    return { accessToken: limited.token, accessTokenExpiresAt: limited.expiresAt };
  }
  const refresh = await createRefreshToken(session.id);
  return {
    accessToken: access.token,
    accessTokenExpiresAt,
    refreshToken: refresh.raw,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),
    prisma.refreshToken.updateMany({
      where: { sessionId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    }),
  ]);
}

/** Revoke every active session of a user (optionally only those bound to one organization). */
export async function revokeUserSessions(
  userId: string,
  reason: string,
  options: { organizationId?: string; exceptSessionId?: string } = {},
): Promise<number> {
  const sessions = await prisma.authSession.findMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    select: { id: true },
  });
  for (const s of sessions) await revokeSession(s.id, reason);
  return sessions.length;
}

const invalidRefresh = () =>
  new UnauthenticatedError('Refresh token is invalid or expired', 'REFRESH_TOKEN_INVALID');

/**
 * Rotate a refresh token: the presented token is consumed and a new one issued. Presenting an
 * already-rotated (or revoked) token is treated as theft: the whole session is revoked.
 */
export async function rotateRefreshToken(raw: string) {
  const now = new Date();
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { session: true },
  });
  if (!token) throw invalidRefresh();
  const { session } = token;

  if (token.status !== 'ACTIVE') {
    await handleReuse(session);
  }
  if (token.expiresAt <= now || session.revokedAt || session.expiresAt <= now) {
    throw invalidRefresh();
  }
  const consumed = await prisma.refreshToken.updateMany({
    where: { id: token.id, status: 'ACTIVE' },
    data: { status: 'ROTATED', usedAt: now },
  });
  if (consumed.count === 0) await handleReuse(session); // lost a race with another use

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  const membershipOk =
    !session.organizationId ||
    session.platformAccessReason !== null ||
    (await prisma.organizationMembership.count({
      where: {
        userId: session.userId,
        organizationId: session.organizationId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    })) > 0;
  if (!user || user.status !== 'ACTIVE' || user.deletedAt || !membershipOk) {
    await revokeSession(session.id, 'access_removed');
    throw invalidRefresh();
  }

  const updated = await prisma.authSession.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    },
  });
  return { session: updated, tokens: await issueTokens(updated, { withRefresh: true }) };
}

async function handleReuse(session: AuthSession): Promise<never> {
  await revokeSession(session.id, 'refresh_token_reuse');
  await recordAudit({
    action: 'auth.refresh_token_reused',
    entityType: 'auth_session',
    entityId: session.id,
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorType: 'user',
  });
  throw new UnauthenticatedError(
    'Refresh token reuse detected; the session has been revoked',
    'REFRESH_TOKEN_REUSED',
  );
}

export async function revokeByRefreshToken(raw: string, reason: string): Promise<void> {
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (token) await revokeSession(token.sessionId, reason);
}

export async function listActiveSessions(userId: string) {
  return prisma.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      organizationId: true,
      deviceName: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      platformAccessReason: true,
    },
  });
}

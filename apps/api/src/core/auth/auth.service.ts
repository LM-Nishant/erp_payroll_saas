import type { LoginInput, MfaVerifyInput } from '@erp/shared';
import type { User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AppError, ForbiddenError, UnauthenticatedError } from '../http/errors';
import { recordAudit } from '../audit/audit';
import { loadPlatformRoleKeys } from '../authz/loader';
import { recordLoginEvent } from './login-events';
import { checkTotp, useRecoveryCode } from './mfa';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from './password';
import { createSession, issueTokens, revokeUserSessions, type IssuedTokens } from './sessions';
import { signMfaToken, verifyMfaToken } from './tokens';
import { consumeUserToken } from './user-tokens';

const invalidCredentials = () =>
  new UnauthenticatedError('Invalid email or password', 'INVALID_CREDENTIALS');

export type LoginOutcome =
  | { mfaRequired: true; mfaToken: string; tokenDelivery: 'body' | 'cookie' }
  | { mfaRequired: false; tokens: IssuedTokens; tokenDelivery: 'body' | 'cookie' };

function isLocked(user: User): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil > new Date());
}

/** Count a failed credential/MFA attempt; locks the account at the configured threshold. */
async function registerFailure(user: User, reason: string): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
  });
  await recordLoginEvent({
    email: user.email,
    userId: user.id,
    success: false,
    failureReason: reason,
  });
  if (updated.failedLoginCount >= env.AUTH_MAX_FAILED_LOGINS) {
    const lockedUntil = new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil, failedLoginCount: 0 },
    });
    await recordAudit({
      action: 'auth.account_locked',
      entityType: 'user',
      entityId: user.id,
      organizationId: null,
      actorUserId: user.id,
      actorType: 'user',
      metadata: { lockedUntil: lockedUntil.toISOString(), reason },
    });
  }
}

function accountLocked(user: User) {
  return new AppError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked', {
    lockedUntil: user.lockedUntil?.toISOString(),
  });
}

/** Pick the organization for a new session from the user's ACTIVE memberships. */
async function resolveLoginOrganization(
  userId: string,
  slug: string | undefined,
): Promise<string | null> {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      deletedAt: null,
      organization: { status: 'ACTIVE', deletedAt: null },
    },
    include: { organization: { select: { id: true, slug: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (slug) {
    const match = memberships.find((m) => m.organization.slug === slug);
    if (!match) {
      throw new ForbiddenError(
        'You do not have access to this organization',
        'ORGANIZATION_ACCESS_DENIED',
      );
    }
    return match.organizationId;
  }
  if (memberships.length === 1) return memberships[0]!.organizationId;
  if (memberships.length > 1) {
    throw new AppError(409, 'ORGANIZATION_SELECTION_REQUIRED', 'Choose an organization', {
      organizations: memberships.map((m) => ({
        slug: m.organization.slug,
        name: m.organization.name,
      })),
    });
  }
  if ((await loadPlatformRoleKeys(userId)).length > 0) return null;
  throw new ForbiddenError(
    'You do not belong to any active organization',
    'NO_ORGANIZATION_ACCESS',
  );
}

async function completeLogin(
  user: User,
  organizationId: string | null,
  options: { mfaUsed: boolean; deviceName?: string | undefined },
): Promise<IssuedTokens> {
  const session = await createSession({
    userId: user.id,
    organizationId,
    mfaVerified: options.mfaUsed,
    deviceName: options.deviceName,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  await recordLoginEvent({
    email: user.email,
    userId: user.id,
    organizationId,
    success: true,
    mfaUsed: options.mfaUsed,
  });
  await recordAudit({
    action: 'auth.login',
    entityType: 'auth_session',
    entityId: session.id,
    organizationId,
    actorUserId: user.id,
    actorType: 'user',
    metadata: { mfaUsed: options.mfaUsed },
  });
  return issueTokens(session, { withRefresh: true });
}

export async function login(input: LoginInput): Promise<LoginOutcome> {
  const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
  if (!user) {
    await verifyDummyPassword(input.password);
    await recordLoginEvent({ email: input.email, success: false, failureReason: 'UNKNOWN_USER' });
    throw invalidCredentials();
  }
  if (isLocked(user)) {
    await recordLoginEvent({
      email: user.email,
      userId: user.id,
      success: false,
      failureReason: 'ACCOUNT_LOCKED',
    });
    throw accountLocked(user);
  }
  if (user.status !== 'ACTIVE' || !user.passwordHash) {
    await verifyDummyPassword(input.password);
    await recordLoginEvent({
      email: user.email,
      userId: user.id,
      success: false,
      failureReason: 'ACCOUNT_DISABLED',
    });
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await registerFailure(user, 'INVALID_PASSWORD');
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (isLocked(refreshed)) throw accountLocked(refreshed);
    throw invalidCredentials();
  }

  const organizationId = await resolveLoginOrganization(user.id, input.organization);
  if (user.mfaEnabled) {
    const { token } = await signMfaToken({
      sub: user.id,
      org: organizationId,
      tokenDelivery: input.tokenDelivery,
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
    });
    return { mfaRequired: true, mfaToken: token, tokenDelivery: input.tokenDelivery };
  }
  const tokens = await completeLogin(user, organizationId, {
    mfaUsed: false,
    deviceName: input.deviceName,
  });
  return { mfaRequired: false, tokens, tokenDelivery: input.tokenDelivery };
}

/** Second login step: exchange the MFA token + TOTP / recovery code for a session. */
export async function verifyMfaLogin(input: MfaVerifyInput): Promise<LoginOutcome> {
  const claims = await verifyMfaToken(input.mfaToken);
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.status !== 'ACTIVE' || user.deletedAt || !user.mfaEnabled) {
    throw new UnauthenticatedError('Invalid token', 'TOKEN_INVALID');
  }
  if (isLocked(user)) throw accountLocked(user);
  const ok = input.code
    ? await checkTotp(user.id, input.code)
    : await useRecoveryCode(user.id, input.recoveryCode!);
  if (!ok) {
    await registerFailure(user, 'INVALID_MFA_CODE');
    throw new UnauthenticatedError('Invalid verification code', 'MFA_INVALID');
  }
  if (input.recoveryCode) {
    await recordAudit({
      action: 'auth.mfa_recovery_code_used',
      entityType: 'user',
      entityId: user.id,
      organizationId: claims.org,
      actorUserId: user.id,
      actorType: 'user',
    });
  }
  const tokens = await completeLogin(user, claims.org, {
    mfaUsed: true,
    deviceName: claims.deviceName,
  });
  return { mfaRequired: false, tokens, tokenDelivery: claims.tokenDelivery };
}

async function setPassword(userId: string, password: string, email: string) {
  assertPasswordPolicy(password, email);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
}

export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  await setPassword(userId, newPassword, user.email);
  await revokeUserSessions(userId, 'password_changed', { exceptSessionId: sessionId });
  await recordAudit({ action: 'auth.password_changed', entityType: 'user', entityId: userId });
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  const row = await consumeUserToken(token, 'PASSWORD_RESET');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
  await setPassword(user.id, newPassword, user.email);
  await revokeUserSessions(user.id, 'password_reset');
  await recordAudit({
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: user.id,
    organizationId: row.organizationId,
    actorUserId: user.id,
    actorType: 'user',
  });
}

export async function acceptInvite(token: string, password: string, name?: string) {
  const row = await consumeUserToken(token, 'INVITE');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
  await setPassword(user.id, password, user.email);
  if (name) await prisma.user.update({ where: { id: user.id }, data: { name } });
  if (row.organizationId) {
    await prisma.organizationMembership.updateMany({
      where: { userId: user.id, organizationId: row.organizationId, status: 'INVITED' },
      data: { status: 'ACTIVE', joinedAt: new Date() },
    });
  }
  await recordAudit({
    action: 'user.invite_accepted',
    entityType: 'user',
    entityId: user.id,
    organizationId: row.organizationId,
    actorUserId: user.id,
    actorType: 'user',
  });
}

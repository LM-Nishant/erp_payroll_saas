import type { UserTokenType } from '@prisma/client';
import { env } from '../config/env';
import { randomToken, sha256 } from '../crypto';
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';

/** Issue a one-time invite / password-reset token (only its hash is stored). */
export async function issueUserToken(input: {
  userId: string;
  organizationId: string | null;
  type: UserTokenType;
}): Promise<{ token: string; expiresAt: Date }> {
  const ttlMs =
    input.type === 'INVITE'
      ? env.INVITE_TOKEN_TTL_HOURS * 3_600_000
      : env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000;
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlMs);
  // Only the newest token of a type stays usable.
  await prisma.userToken.updateMany({
    where: { userId: input.userId, type: input.type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.userToken.create({
    data: { ...input, tokenHash: sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

/** Atomically consume a token; throws 400 INVALID_TOKEN if unknown, used or expired. */
export async function consumeUserToken(raw: string, type: UserTokenType) {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: sha256(raw) } });
  const invalid = new AppError(400, 'INVALID_TOKEN', 'Token is invalid or has expired');
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) throw invalid;
  const consumed = await prisma.userToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) throw invalid;
  return row;
}

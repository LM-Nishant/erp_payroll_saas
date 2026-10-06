import { randomInt } from 'node:crypto';
import { env } from '../config/env';
import { decryptSecret, encryptSecret, sha256 } from '../crypto';
import { prisma } from '../db/prisma';
import { AppError, ConflictError, UnauthenticatedError } from '../http/errors';
import { recordAudit } from '../audit/audit';
import { verifyPassword } from './password';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_CODE_COUNT = 10;

export const normalizeRecoveryCode = (code: string) => code.replace(/-/g, '').toLowerCase();

function newRecoveryCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })),
    }),
  ]);
  return codes;
}

const invalidCode = () => new AppError(400, 'MFA_INVALID', 'Invalid verification code');

async function getUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthenticatedError();
  return user;
}

/** Verify a TOTP code against the ACTIVE secret, with replay protection. */
export async function checkTotp(userId: string, code: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;
  const step = verifyTotp(decryptSecret(user.mfaSecretEnc), code, {
    afterStep: user.mfaLastUsedStep,
  });
  if (step === null) return false;
  const updated = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
    },
    data: { mfaLastUsedStep: step },
  });
  return updated.count === 1;
}

/** Consume a single-use recovery code. */
export async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
  const updated = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null },
    data: { usedAt: new Date() },
  });
  return updated.count > 0;
}

export async function startMfaEnrollment(userId: string) {
  const user = await getUser(userId);
  if (user.mfaEnabled) throw new ConflictError('MFA is already enabled');
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { mfaPendingSecretEnc: encryptSecret(secret) },
  });
  return {
    secret,
    otpauthUri: otpauthUri({ secret, account: user.email, issuer: env.MFA_ISSUER }),
  };
}

export async function activateMfa(userId: string, code: string) {
  const user = await getUser(userId);
  if (user.mfaEnabled) throw new ConflictError('MFA is already enabled');
  if (!user.mfaPendingSecretEnc) {
    throw new AppError(400, 'MFA_NOT_ENROLLING', 'Start MFA enrollment first');
  }
  const step = verifyTotp(decryptSecret(user.mfaPendingSecretEnc), code);
  if (step === null) throw invalidCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecretEnc: user.mfaPendingSecretEnc,
      mfaPendingSecretEnc: null,
      mfaLastUsedStep: step,
    },
  });
  const recoveryCodes = await replaceRecoveryCodes(userId);
  await recordAudit({ action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
  return { recoveryCodes };
}

export async function disableMfa(userId: string, password: string, code: string) {
  const user = await getUser(userId);
  if (!user.mfaEnabled) throw new ConflictError('MFA is not enabled');
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(400, 'INVALID_CREDENTIALS', 'Password is incorrect');
  }
  if (!(await checkTotp(userId, code))) throw invalidCode();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaLastUsedStep: null,
      },
    }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  await recordAudit({ action: 'auth.mfa_disabled', entityType: 'user', entityId: userId });
}

export async function regenerateRecoveryCodes(userId: string, code: string) {
  if (!(await checkTotp(userId, code))) throw invalidCode();
  const recoveryCodes = await replaceRecoveryCodes(userId);
  await recordAudit({
    action: 'auth.mfa_recovery_codes_regenerated',
    entityType: 'user',
    entityId: userId,
  });
  return { recoveryCodes };
}

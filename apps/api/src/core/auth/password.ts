import { hash, verify } from '@node-rs/argon2';
import { passwordPolicyViolations } from '@erp/shared';
import { ValidationError } from '../http/errors';

/** argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). */
const OPTIONS = {
  algorithm: 2 /* Algorithm.Argon2id (ambient const enum) */,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burn comparable CPU when the user does not exist (mitigates user enumeration by timing). */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(await dummyHash, password);
}

export function assertPasswordPolicy(password: string, email?: string): void {
  const problems = passwordPolicyViolations(password, email);
  if (problems.length > 0) {
    throw new ValidationError('Password does not meet the password policy', {
      code: 'PASSWORD_POLICY',
      issues: problems.map((message) => ({ path: 'password', code: 'password_policy', message })),
    });
  }
}

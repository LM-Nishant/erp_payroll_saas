import { describe, expect, it } from 'vitest';
import { ValidationError } from '../http/errors';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('enforces the policy', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(ValidationError);
    expect(() => assertPasswordPolicy('Correct-Horse-9')).not.toThrow();
  });
});

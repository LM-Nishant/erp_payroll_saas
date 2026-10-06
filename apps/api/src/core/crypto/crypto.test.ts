import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, randomToken, sha256 } from './index';

describe('crypto helpers', () => {
  it('round-trips encrypted secrets with random IVs', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const parts = encryptSecret('secret').split('.');
    parts[3] = Buffer.from('xxxxxx').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('hashes and generates tokens', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

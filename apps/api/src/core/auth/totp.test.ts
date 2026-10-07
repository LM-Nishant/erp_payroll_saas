import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B secret (ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('round-trips base32', () => {
    const buf = Buffer.from('hello world!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('matches RFC 4226 HOTP vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 9)).toBe('520489');
  });

  it('matches RFC 6238 TOTP vectors (6 digits)', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('verifies within the window and blocks replay', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now - 30_000);
    const step = verifyTotp(RFC_SECRET, code, { nowMs: now });
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, afterStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now + 120_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000', { nowMs: now })).toBeNull();
  });

  it('builds otpauth URIs', () => {
    expect(otpauthUri({ secret: 'ABC', account: 'a@b.c', issuer: 'ERP' })).toBe(
      'otpauth://totp/ERP%3Aa%40b.c?secret=ABC&issuer=ERP&algorithm=SHA1&digits=6&period=30',
    );
  });
});

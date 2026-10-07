import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signAccessToken, signMfaToken, verifyAccessToken, verifyMfaToken } from './tokens';

describe('JWT tokens', () => {
  it('round-trips access tokens', async () => {
    const { token } = await signAccessToken({ sub: 'u1', sid: 's1', org: 'o1' });
    expect(await verifyAccessToken(token)).toEqual({ sub: 'u1', sid: 's1', org: 'o1' });
  });

  it('rejects an MFA token used as an access token (typ confusion)', async () => {
    const { token } = await signMfaToken({ sub: 'u1', org: null, tokenDelivery: 'body' });
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect((await verifyMfaToken(token)).sub).toBe('u1');
  });

  it('flags expired tokens', async () => {
    const { token } = await signAccessToken({ sub: 'u', sid: 's', org: null }, -10);
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('rejects tokens signed with another key', async () => {
    const forged = await new SignJWT({ typ: 'access', sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .sign(new TextEncoder().encode('x'.repeat(40)));
    await expect(verifyAccessToken(forged)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });
});

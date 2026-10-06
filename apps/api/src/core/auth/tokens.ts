import { randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env';
import { UnauthenticatedError } from '../http/errors';

const secret = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessClaims {
  /** User id. */
  sub: string;
  /** AuthSession id. */
  sid: string;
  /** Organization the session is bound to (null: platform-only session). */
  org: string | null;
}

export interface MfaClaims {
  sub: string;
  org: string | null;
  deviceName?: string;
  tokenDelivery: 'body' | 'cookie';
}

async function sign(payload: JWTPayload, typ: string, ttlSeconds: number) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const token = await new SignJWT({ ...payload, typ })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setSubject(String(payload.sub))
    .sign(secret());
  return { token, expiresAt };
}

async function verify(token: string, typ: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (payload.typ !== typ || typeof payload.sub !== 'string') throw new Error('typ');
    return payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthenticatedError('Token expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthenticatedError('Invalid token', 'TOKEN_INVALID');
  }
}

export function signAccessToken(claims: AccessClaims, ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS) {
  return sign({ ...claims }, 'access', ttlSeconds);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const payload = await verify(token, 'access');
  if (typeof payload.sid !== 'string') {
    throw new UnauthenticatedError('Invalid token', 'TOKEN_INVALID');
  }
  return {
    sub: payload.sub!,
    sid: payload.sid,
    org: typeof payload.org === 'string' ? payload.org : null,
  };
}

/** Short-lived token proving the password step succeeded; exchanged at /auth/mfa/verify. */
export function signMfaToken(claims: MfaClaims) {
  return sign({ ...claims }, 'mfa', env.MFA_TOKEN_TTL_SECONDS);
}

export async function verifyMfaToken(token: string): Promise<MfaClaims> {
  const payload = await verify(token, 'mfa');
  return {
    sub: payload.sub!,
    org: typeof payload.org === 'string' ? payload.org : null,
    deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : undefined,
    tokenDelivery: payload.tokenDelivery === 'cookie' ? 'cookie' : 'body',
  };
}

/** Access token of a machine API client (OAuth2 client credentials, core/integrations). */
export interface ClientClaims {
  /** ApiClient row id. */
  sub: string;
  org: string;
  /** Granted scopes (subset of the client's scopes at issue time). */
  scope: string[];
}

export function signClientToken(claims: ClientClaims, ttlSeconds: number) {
  return sign(
    { sub: claims.sub, org: claims.org, scope: claims.scope.join(' ') },
    'client',
    ttlSeconds,
  );
}

export async function verifyClientToken(token: string): Promise<ClientClaims> {
  const payload = await verify(token, 'client');
  if (typeof payload.org !== 'string' || typeof payload.scope !== 'string') {
    throw new UnauthenticatedError('Invalid token', 'TOKEN_INVALID');
  }
  return { sub: payload.sub!, org: payload.org, scope: payload.scope.split(' ').filter(Boolean) };
}

/** Unverified `typ` claim (routing only — the token is verified by the matching verifier). */
export function peekTokenType(token: string): string | null {
  try {
    const typ = decodeJwt(token).typ;
    return typeof typ === 'string' ? typ : null;
  } catch {
    return null;
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed tokens for the local (filesystem / memory) providers, served by
 * `GET|PUT /api/v1/storage/local/:token`. They emulate S3 pre-signed URLs: short-lived,
 * HMAC-signed, bound to one key and operation (and, for uploads, content type and length).
 */
export interface LocalTokenPayload {
  /** Provider instance id (memory / local). */
  p: string;
  op: 'get' | 'put';
  key: string;
  /** Expiry, epoch seconds. */
  exp: number;
  ct: string;
  /** get: download file name + disposition; put: exact content length. */
  fn?: string;
  disp?: 'attachment' | 'inline';
  len?: number;
  sha?: string;
}

const b64 = (buf: Buffer) => buf.toString('base64url');

export function signLocalToken(payload: LocalTokenPayload, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  const mac = b64(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/** Returns the payload when the signature is valid and not expired; null otherwise. */
export function verifyLocalToken(
  token: string,
  secret: string,
  now = Date.now(),
): LocalTokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as LocalTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

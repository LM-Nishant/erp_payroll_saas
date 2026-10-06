import express, { Router } from 'express';
import { env } from '../config/env';
import { ForbiddenError, NotFoundError, ValidationError } from '../http/errors';
import { verifyLocalToken } from './local-signing';
import { localProvider } from './registry';
import { contentDisposition } from './s3';

/**
 * Signed-URL endpoint of the local providers (dev/test stand-in for S3 pre-signed URLs).
 * Unauthenticated by design — the HMAC token IS the authorization, exactly like S3.
 */
export function localStorageRouter(): Router {
  const router = Router();
  const fail = () => new ForbiddenError('Invalid or expired storage URL', 'INVALID_SIGNATURE');

  router.get('/:token', async (req, res) => {
    const payload = verifyLocalToken(req.params.token, env.STORAGE_LOCAL_SIGNING_SECRET);
    if (!payload || payload.op !== 'get') throw fail();
    const provider = localProvider(payload.p);
    if (!provider) throw fail();
    const head = await provider.headObject(payload.key);
    if (!head) throw new NotFoundError('Object');
    const body = await provider.getObject(payload.key);
    res.setHeader('Content-Type', payload.ct);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(payload.disp ?? 'attachment', payload.fn ?? 'file'),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  });

  router.put(
    '/:token',
    express.raw({ type: () => true, limit: env.STORAGE_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const payload = verifyLocalToken(req.params.token, env.STORAGE_LOCAL_SIGNING_SECRET);
      if (!payload || payload.op !== 'put') throw fail();
      const provider = localProvider(payload.p);
      if (!provider) throw fail();
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== payload.ct) throw new ValidationError('Content-Type does not match the URL');
      if (payload.len !== undefined && body.length !== payload.len) {
        throw new ValidationError('Content-Length does not match the URL');
      }
      try {
        await provider.putObject({
          key: payload.key,
          body,
          contentType: payload.ct,
          checksumSha256: payload.sha,
        });
      } catch {
        throw new ValidationError('Checksum does not match the URL');
      }
      res.status(200).end();
    },
  );
  return router;
}

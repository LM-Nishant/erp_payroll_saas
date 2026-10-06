import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

/** Per-request metadata used by the audit engine and login history. */
export interface RequestMeta {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestMeta>();

export const requestContext: RequestHandler = (req, res, next) => {
  const meta: RequestMeta = {
    requestId: res.locals.requestId as string | undefined,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 512),
  };
  storage.run(meta, () => next());
};

export function currentRequestMeta(): RequestMeta {
  return storage.getStore() ?? {};
}

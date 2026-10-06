import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Accepts a well-formed inbound X-Request-Id (e.g. from a gateway) or generates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.get(REQUEST_ID_HEADER);
  const id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

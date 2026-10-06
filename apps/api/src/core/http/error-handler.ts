import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorResponse } from '@erp/shared';
import { logger } from '../logger';
import { AppError, ConflictError, NotFoundError, ValidationError } from './errors';

function fromPrismaError(err: Prisma.PrismaClientKnownRequestError): AppError | undefined {
  switch (err.code) {
    case 'P2002':
      return new ConflictError('A record with the same unique value already exists', {
        target: err.meta?.target,
      });
    case 'P2003':
      return new ConflictError('Operation violates a foreign key constraint');
    case 'P2025':
      return new NotFoundError();
    default:
      return undefined;
  }
}

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = fromPrismaError(err);
    if (mapped) return mapped;
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    return new ValidationError('Malformed JSON body');
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = normalize(err);
  const requestId = res.locals.requestId as string | undefined;
  const log = req.log ?? logger;

  if (appError.status >= 500) {
    log.error({ err, requestId }, 'Unhandled error');
  } else {
    log.debug({ code: appError.code, requestId }, appError.message);
  }

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Internal server error',
      requestId,
      ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  res.status(appError.status).json(body);
};

import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'erp-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.secret',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});

export type Logger = typeof logger;

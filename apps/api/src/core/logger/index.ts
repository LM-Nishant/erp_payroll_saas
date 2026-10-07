import pino from 'pino';
import { env } from '../config/env';

/** Log redaction (exported for tests). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  // Secret management: plaintext values must never reach the logs.
  'req.body.value',
  '*.plaintext',
  '*.apiKey',
  '*.privateKey',
  '*.dataKey',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'erp-api' },
  redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});

export type Logger = typeof logger;

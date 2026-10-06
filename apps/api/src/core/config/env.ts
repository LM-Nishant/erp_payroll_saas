import { existsSync } from 'node:fs';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((v) => v.startsWith('mysql://'), 'DATABASE_URL must be a mysql:// connection string'),
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
    QUEUE_PREFIX: z.string().min(1).default('erp'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    TENANT_RESOLVER: z.enum(['dev-header', 'none']).default('none'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.TENANT_RESOLVER === 'dev-header') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_RESOLVER'],
        message: 'The dev-header tenant resolver is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

// Local convenience: load apps/api/.env when present (never in tests, never overrides real env).
if (!process.env.VITEST && existsSync('.env')) {
  process.loadEnvFile('.env');
}

export const env: Env = parseEnv(process.env);

import { existsSync } from 'node:fs';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Insecure fallbacks used ONLY outside production so dev/test work out of the box. */
export const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';
export const DEV_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
export const DEV_SECRETS_MASTER_KEYS = `1:${Buffer.alloc(32, 9).toString('base64')}`;

/** Parse `SECRETS_MASTER_KEYS` (`<version>:<base64 32 bytes>[,…]`) into a version → key map. */
export function parseMasterKeys(value: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = /^(\d+):(.+)$/.exec(entry);
    if (!match) throw new Error('Entries must look like <version>:<base64 key>');
    const version = Number(match[1]);
    const key = Buffer.from(match[2]!, 'base64');
    if (version < 1 || key.length !== 32) throw new Error('Keys must be 32 bytes, versions >= 1');
    if (keys.has(version)) throw new Error(`Duplicate key version ${version}`);
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error('At least one master key is required');
  return keys;
}

const intFrom = (min: number, def: number) => z.coerce.number().int().min(min).default(def);

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
    /**
     * `jwt`: tenant derived from the authenticated access token (default).
     * `dev-header`: jwt, falling back to the X-Dev-Organization header (dev/test only).
     * `none`: deny all tenant-scoped requests.
     */
    TENANT_RESOLVER: z.enum(['jwt', 'dev-header', 'none']).default('jwt'),
    /** Express `trust proxy` setting: false, true or a hop count. Needed for correct client IPs. */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : Number(v)))
      .refine((v) => typeof v === 'boolean' || (Number.isInteger(v) && v >= 0), 'Invalid'),

    // --- Authentication -------------------------------------------------------------
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    JWT_ISSUER: z.string().min(1).default('erp-api'),
    JWT_AUDIENCE: z.string().min(1).default('erp'),
    ACCESS_TOKEN_TTL_SECONDS: intFrom(60, 900),
    REFRESH_TOKEN_TTL_DAYS: intFrom(1, 30),
    MFA_TOKEN_TTL_SECONDS: intFrom(60, 300),
    MFA_ISSUER: z.string().min(1).default('Education ERP'),
    AUTH_MAX_FAILED_LOGINS: intFrom(1, 5),
    AUTH_LOCKOUT_MINUTES: intFrom(1, 15),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: intFrom(1, 60),
    AUTH_RATE_LIMIT_MAX: intFrom(1, 20),
    INVITE_TOKEN_TTL_HOURS: intFrom(1, 72),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: intFrom(5, 60),
    PLATFORM_ACCESS_TTL_MINUTES: intFrom(5, 30),
    /** base64 32-byte key for AES-256-GCM encryption of MFA secrets (Layer 3 adds a KMS). */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be 32 bytes, base64')
      .optional(),

    // --- Secret management (core/secrets) ---------------------------------------------
    /** Key provider wrapping per-secret data keys. `local` = master keys from env. */
    SECRETS_KEY_PROVIDER: z.enum(['local']).default('local'),
    /** `<version>:<base64 32-byte key>` entries, comma separated (old versions kept for unwrap). */
    SECRETS_MASTER_KEYS: z
      .string()
      .superRefine((v, ctx) => {
        try {
          parseMasterKeys(v);
        } catch (err) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
        }
      })
      .optional(),
    /** Version used to wrap NEW data keys. Defaults to the highest configured version. */
    SECRETS_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const masterKeys = value.SECRETS_MASTER_KEYS ?? DEV_SECRETS_MASTER_KEYS;
    if (
      value.SECRETS_ACTIVE_KEY_VERSION !== undefined &&
      !safeParseMasterKeys(masterKeys)?.has(value.SECRETS_ACTIVE_KEY_VERSION)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECRETS_ACTIVE_KEY_VERSION'],
        message: 'No master key with this version in SECRETS_MASTER_KEYS',
      });
    }
    if (value.NODE_ENV === 'production') {
      for (const key of [
        'JWT_ACCESS_SECRET',
        'DATA_ENCRYPTION_KEY',
        'SECRETS_MASTER_KEYS',
      ] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
    if (value.NODE_ENV === 'production' && value.TENANT_RESOLVER === 'dev-header') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_RESOLVER'],
        message: 'The dev-header tenant resolver is not allowed in production',
      });
    }
  });

function safeParseMasterKeys(value: string): Map<number, Buffer> | null {
  try {
    return parseMasterKeys(value);
  } catch {
    return null;
  }
}

type ParsedEnv = z.infer<typeof envSchema>;
export type Env = ParsedEnv & {
  JWT_ACCESS_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
  SECRETS_MASTER_KEYS: string;
  SECRETS_ACTIVE_KEY_VERSION: number;
};

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const masterKeys = result.data.SECRETS_MASTER_KEYS ?? DEV_SECRETS_MASTER_KEYS;
  return {
    ...result.data,
    JWT_ACCESS_SECRET: result.data.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET,
    DATA_ENCRYPTION_KEY: result.data.DATA_ENCRYPTION_KEY ?? DEV_DATA_ENCRYPTION_KEY,
    SECRETS_MASTER_KEYS: masterKeys,
    SECRETS_ACTIVE_KEY_VERSION:
      result.data.SECRETS_ACTIVE_KEY_VERSION ?? Math.max(...parseMasterKeys(masterKeys).keys()),
  };
}

// Local convenience: load apps/api/.env when present (never in tests, never overrides real env).
if (!process.env.VITEST && existsSync('.env')) {
  process.loadEnvFile('.env');
}

export const env: Env = parseEnv(process.env);

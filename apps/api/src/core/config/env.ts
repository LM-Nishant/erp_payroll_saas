import { existsSync } from 'node:fs';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Insecure fallbacks used ONLY outside production so dev/test work out of the box. */
export const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';
export const DEV_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
export const DEV_STORAGE_SIGNING_SECRET = 'dev-only-insecure-storage-signing-secret-0123456789';
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

    // --- File storage (core/storage) -------------------------------------------------
    /** `s3` (production), `local` (filesystem, dev) or `memory` (tests; never production). */
    STORAGE_DRIVER: z.enum(['s3', 'local', 'memory']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.storage'),
    /** HMAC key for local/memory signed URLs (dev default derived when unset). */
    STORAGE_LOCAL_SIGNING_SECRET: z.string().min(32).optional(),
    /** Public origin of this API used to build local signed URLs (empty = relative URLs). */
    STORAGE_PUBLIC_BASE_URL: z
      .string()
      .url()
      .optional()
      .transform((v) => v?.replace(/\/+$/, '')),
    STORAGE_S3_BUCKET: z.string().min(3).optional(),
    STORAGE_S3_REGION: z.string().min(1).default('ap-south-1'),
    /** Custom endpoint for S3-compatible stores (MinIO, R2…). */
    STORAGE_S3_ENDPOINT: z.string().url().optional(),
    STORAGE_S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Optional static credentials; default is the AWS SDK credential chain (IAM role). */
    STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_S3_SSE: z.enum(['AES256', 'aws:kms']).default('AES256'),
    STORAGE_S3_KMS_KEY_ID: z.string().min(1).optional(),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    STORAGE_MAX_UPLOAD_BYTES: intFrom(1024, 25 * 1024 * 1024),
    /** Days a soft-deleted document's objects are kept before `purgeExpiredDocuments`. */
    DOCUMENT_RETENTION_DAYS: intFrom(0, 30),

    // --- Queue, communication & integrations (Layer 5) ----------------------------------
    /** `bullmq` (Redis; run `pnpm worker`) or `inline` (in-process; tests / Redis-less dev). */
    QUEUE_DRIVER: z.enum(['bullmq', 'inline']).optional(),
    QUEUE_CONCURRENCY: intFrom(1, 5),
    /** Store for auth/API rate-limit counters (`redis` shares limits across API instances). */
    RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
    /** Public origin of the web app (links in emails: invite / reset / notifications). */
    APP_PUBLIC_URL: z
      .string()
      .url()
      .default('http://localhost:5173')
      .transform((v) => v.replace(/\/+$/, '')),
    /** Public origin of this API (delivery-callback URLs shown to admins). */
    API_PUBLIC_URL: z
      .string()
      .url()
      .default('http://localhost:3000')
      .transform((v) => v.replace(/\/+$/, '')),
    /**
     * Platform fallback mailer for system emails (invites, password resets) when a tenant has
     * no email provider configured: `log` (outbox only, dev/test) or `smtp` (SMTP_URL).
     */
    MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    SMTP_URL: z.string().url().optional(),
    MAIL_FROM: z.string().min(3).default('Education ERP <no-reply@erp.local>'),
    /** Outbound HTTP timeout for webhooks / SMS / WhatsApp provider calls. */
    OUTBOUND_HTTP_TIMEOUT_MS: intFrom(500, 10_000),
    /** Allow plain-http / private-network webhook targets (never in production). */
    WEBHOOK_ALLOW_INSECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    API_CLIENT_TOKEN_TTL_SECONDS: intFrom(60, 3600),
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
    if (value.NODE_ENV === 'production' && value.STORAGE_DRIVER === 'memory') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_DRIVER'],
        message: 'The memory storage driver is not allowed in production',
      });
    }
    if (value.STORAGE_DRIVER === 's3' && !value.STORAGE_S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_S3_BUCKET'],
        message: 'STORAGE_S3_BUCKET is required for the s3 storage driver',
      });
    }
    if (value.NODE_ENV === 'production' && value.STORAGE_DRIVER === 'local') {
      if (!value.STORAGE_LOCAL_SIGNING_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_LOCAL_SIGNING_SECRET'],
          message: 'STORAGE_LOCAL_SIGNING_SECRET is required for local storage in production',
        });
      }
    }
    if (value.MAIL_DRIVER === 'smtp' && !value.SMTP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_URL'],
        message: 'SMTP_URL is required for the smtp mail driver',
      });
    }
    if (value.NODE_ENV === 'production' && value.WEBHOOK_ALLOW_INSECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_ALLOW_INSECURE'],
        message: 'Insecure webhook targets are not allowed in production',
      });
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
  STORAGE_LOCAL_SIGNING_SECRET: string;
  QUEUE_DRIVER: 'bullmq' | 'inline';
  WEBHOOK_ALLOW_INSECURE: boolean;
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
    STORAGE_LOCAL_SIGNING_SECRET:
      result.data.STORAGE_LOCAL_SIGNING_SECRET ?? DEV_STORAGE_SIGNING_SECRET,
    QUEUE_DRIVER:
      result.data.QUEUE_DRIVER ?? (result.data.NODE_ENV === 'test' ? 'inline' : 'bullmq'),
    WEBHOOK_ALLOW_INSECURE:
      result.data.WEBHOOK_ALLOW_INSECURE ?? result.data.NODE_ENV !== 'production',
  };
}

// Local convenience: load apps/api/.env when present (never in tests, never overrides real env).
if (!process.env.VITEST && existsSync('.env')) {
  process.loadEnvFile('.env');
}

export const env: Env = parseEnv(process.env);

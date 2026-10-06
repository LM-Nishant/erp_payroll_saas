import { z } from 'zod';
import { idSchema, nameSchema, paginationQuerySchema } from './common';
import { refineSettingTarget, settingScopeTypeSchema } from './licensing';
import { eventKeySchema } from './notifications';

/*
 * Integration framework (core/integrations): machine API clients (OAuth2 client credentials),
 * outbound webhooks and third-party integration credentials.
 */

const permissionCodeSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

export const createApiClientSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().max(1000).nullish(),
    /** API scopes = permission codes the client may use (subset of the API-allowed catalog). */
    scopes: z.array(permissionCodeSchema).min(1).max(100),
    /** Hierarchy the client is restricted to (ORGANIZATION = whole tenant). */
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    rateLimitPerMinute: z.number().int().min(1).max(100_000).default(600),
    expiresAt: z.coerce.date().nullish(),
  })
  .strict()
  .superRefine(refineSettingTarget);
export type CreateApiClientInput = z.infer<typeof createApiClientSchema>;

export const updateApiClientSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(1000).nullish(),
    scopes: z.array(permissionCodeSchema).min(1).max(100).optional(),
    rateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
    expiresAt: z.coerce.date().nullish(),
  })
  .strict();
export type UpdateApiClientInput = z.infer<typeof updateApiClientSchema>;

export const listApiUsageQuerySchema = paginationQuerySchema.omit({ search: true }).strict();

/** OAuth2 client-credentials grant (RFC 6749 §4.4); credentials may also come via Basic auth. */
export const clientCredentialsTokenSchema = z
  .object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().trim().min(1).max(100).optional(),
    client_secret: z.string().min(1).max(200).optional(),
    /** Space-separated subset of the client's scopes. */
    scope: z.string().trim().max(4000).optional(),
  })
  .strict();
export type ClientCredentialsTokenInput = z.infer<typeof clientCredentialsTokenSchema>;

/** Event subscription pattern: exact key, `prefix.*` or `*`. */
export const webhookEventPatternSchema = z.union([
  z.literal('*'),
  eventKeySchema,
  z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*\.\*$/, 'Pattern like employee.*'),
]);

export const createWebhookSchema = z
  .object({
    name: nameSchema,
    url: z.string().trim().url().max(2000),
    events: z.array(webhookEventPatternSchema).min(1).max(50),
    description: z.string().trim().max(1000).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    name: nameSchema.optional(),
    url: z.string().trim().url().max(2000).optional(),
    events: z.array(webhookEventPatternSchema).min(1).max(50).optional(),
    description: z.string().trim().max(1000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const listWebhookDeliveriesQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({ status: z.enum(['PENDING', 'RETRYING', 'DELIVERED', 'FAILED']).optional() })
  .strict();
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;

export const integrationProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Lower snake_case provider, e.g. tally, biometric');

export const createIntegrationCredentialSchema = z
  .object({
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    provider: integrationProviderSchema,
    name: z
      .string()
      .trim()
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
      .default('default'),
    description: z.string().trim().max(500).nullish(),
    /** Write-only credential (API key / token / JSON), stored as a tenant secret. */
    credentials: z.string().min(1).max(8192),
    config: z
      .record(
        z
          .string()
          .max(64)
          .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        z.union([z.string().max(500), z.number(), z.boolean()]),
      )
      .default({}),
  })
  .strict()
  .superRefine(refineSettingTarget);
export type CreateIntegrationCredentialInput = z.infer<typeof createIntegrationCredentialSchema>;

export const updateIntegrationCredentialSchema = z
  .object({
    description: z.string().trim().max(500).nullish(),
    credentials: z.string().min(1).max(8192).optional(),
    config: z
      .record(
        z
          .string()
          .max(64)
          .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        z.union([z.string().max(500), z.number(), z.boolean()]),
      )
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateIntegrationCredentialInput = z.infer<typeof updateIntegrationCredentialSchema>;

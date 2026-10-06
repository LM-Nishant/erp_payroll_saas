import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { refineSettingTarget, settingScopeTypeSchema } from './licensing';

/*
 * Secret management (spec §44/§62). Secret VALUES are write-only: no response ever contains
 * them; reads return masked metadata only.
 */

/** e.g. `smtp`, `sms`, `whatsapp`, `ai.openai`, `storage`. */
export const secretKindSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, 'Kind must be lower-case, dot separated');

export const secretNameSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Name may contain letters, digits, "_", "." and "-"');

export const secretValueSchema = z.string().min(1).max(8192);

/** Non-secret display/config values stored next to a secret (e.g. host, sender id, model). */
export const secretMetadataSchema = z
  .record(
    z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    z.union([z.string().max(500), z.number(), z.boolean()]),
  )
  .refine((v) => Object.keys(v).length <= 20, 'At most 20 metadata entries');

export const createSecretSchema = z
  .object({
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    kind: secretKindSchema,
    name: secretNameSchema.default('default'),
    description: z.string().trim().max(500).nullish(),
    value: secretValueSchema,
    metadata: secretMetadataSchema.nullish(),
  })
  .strict()
  .superRefine(refineSettingTarget);
export type CreateSecretInput = z.infer<typeof createSecretSchema>;

export const rotateSecretSchema = z.object({ value: secretValueSchema }).strict();
export type RotateSecretInput = z.infer<typeof rotateSecretSchema>;

export const updateSecretSchema = z
  .object({
    description: z.string().trim().max(500).nullish(),
    metadata: secretMetadataSchema.nullish(),
  })
  .strict();
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;

export const listSecretsQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({
    kind: secretKindSchema.optional(),
    scopeType: settingScopeTypeSchema.optional(),
    targetId: idSchema.optional(),
  })
  .strict();
export type ListSecretsQuery = z.infer<typeof listSecretsQuerySchema>;

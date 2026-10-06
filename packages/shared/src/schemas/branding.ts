import { z } from 'zod';
import { idSchema } from './common';

/*
 * Branding (spec §65.5 / §65.37): every field is optional and inherits
 * institution → group → organization → platform default when null.
 */

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullish();

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be #RRGGBB')
  .transform((v) => v.toUpperCase());

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Must be a valid domain name',
  );

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'Must be a valid subdomain label');

/**
 * Storage key placeholder for the logo until the file storage engine (Layer 4) exists; Layer 4
 * adds `logoFileId` (document/file id) and the upload flow.
 */
export const storageKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, 'Invalid storage key')
  .refine((v) => !v.split('/').includes('..'), 'Invalid storage key');

export const brandingInputSchema = z
  .object({
    displayName: optionalText(200),
    shortName: optionalText(50),
    logoStorageKey: storageKeySchema.nullish(),
    primaryColor: hexColorSchema.nullish(),
    secondaryColor: hexColorSchema.nullish(),
    accentColor: hexColorSchema.nullish(),
    letterheadText: optionalText(2000),
    footerText: optionalText(1000),
    address: optionalText(500),
    contactEmail: z.string().trim().email().max(200).nullish(),
    contactPhone: optionalText(32),
    website: z.string().trim().url().max(300).nullish(),
    customDomain: hostnameSchema.nullish(),
    subdomain: subdomainSchema.nullish(),
  })
  .strict();
export type BrandingInput = z.infer<typeof brandingInputSchema>;

export const resolvedBrandingQuerySchema = z
  .object({ groupId: idSchema.optional(), institutionId: idSchema.optional() })
  .strict();
export type ResolvedBrandingQuery = z.infer<typeof resolvedBrandingQuerySchema>;

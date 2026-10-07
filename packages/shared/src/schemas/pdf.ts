import { z } from 'zod';
import { idSchema } from './common';
import {
  DOCUMENT_CATEGORY_KEYS,
  DOCUMENT_CONFIDENTIALITY,
  documentFileNameSchema,
  documentOwnerTypeSchema,
} from './documents';

/*
 * PDF engine (spec §36): code-registered, versioned templates rendered with the resolved
 * branding and stored as documents.
 */

export const pdfTemplateKeySchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Template key must be a lower snake_case code');

export const generatePdfSchema = z
  .object({
    templateKey: pdfTemplateKeySchema,
    /** Template input; validated by the template's own schema. */
    data: z.record(z.unknown()).default({}),
    ownerType: documentOwnerTypeSchema.default('organization'),
    ownerId: idSchema.optional(),
    title: z.string().trim().min(1).max(255).optional(),
    fileName: documentFileNameSchema.optional(),
    category: z.enum(DOCUMENT_CATEGORY_KEYS).optional(),
    documentType: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).optional(),
  })
  .strict();
export type GeneratePdfInput = z.input<typeof generatePdfSchema>;

export const genericLetterInputSchema = z
  .object({
    date: z.string().trim().max(50).optional(),
    reference: z.string().trim().max(100).optional(),
    recipientName: z.string().trim().min(1).max(200),
    recipientAddress: z.string().trim().max(1000).optional(),
    subject: z.string().trim().min(1).max(300),
    salutation: z.string().trim().max(100).optional(),
    body: z.string().trim().min(1).max(20_000),
    closing: z.string().trim().max(100).optional(),
    signatoryName: z.string().trim().max(200).optional(),
    signatoryDesignation: z.string().trim().max(200).optional(),
  })
  .strict();
export type GenericLetterInput = z.infer<typeof genericLetterInputSchema>;

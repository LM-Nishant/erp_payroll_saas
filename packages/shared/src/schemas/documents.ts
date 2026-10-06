import { z } from 'zod';
import { SCOPE_TYPES } from '../auth/permissions';
import { idSchema, paginationQuerySchema } from './common';

/*
 * Document engine (spec §29–§37). Files live in private object storage; the database only holds
 * metadata, immutable versions, explicit grants, expiry reminders and signature requests.
 */

/** Confidentiality ladder: CONFIDENTIAL needs `document.view_confidential` in scope;
 * RESTRICTED needs it organization-wide (or an explicit grant / owner access). */
export const DOCUMENT_CONFIDENTIALITY = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
] as const;
export type DocumentConfidentiality = (typeof DOCUMENT_CONFIDENTIALITY)[number];

export const DOCUMENT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Actions an explicit grant (or owner resolver) can allow on one document. */
export const DOCUMENT_ACTIONS = ['view', 'download', 'upload_version', 'delete', 'share'] as const;
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];

export const DOCUMENT_SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'] as const;
export type DocumentScanStatus = (typeof DOCUMENT_SCAN_STATUSES)[number];

export const DOCUMENT_SIGNATURE_STATUSES = [
  'PENDING',
  'SENT',
  'SIGNED',
  'DECLINED',
  'CANCELLED',
] as const;
export type DocumentSignatureStatus = (typeof DOCUMENT_SIGNATURE_STATUSES)[number];

/**
 * Document categories (spec §35). Later layers ADD categories here; never rename one.
 * `documentType` is a free code within a category (e.g. identity/pan, payroll/payslip).
 */
export const DOCUMENT_CATEGORIES = {
  identity: 'Identity (PAN, Aadhaar, passport, driving licence)',
  education: 'Education (degree, marksheet, certificates)',
  employment: 'Employment letters (offer, appointment, revision, relieving…)',
  payroll: 'Payroll (payslips, Form 16, tax documents, investment proofs)',
  student: 'Student records',
  institution: 'Institution documents (registrations, affiliations, policies)',
  asset: 'Asset documents (handover, return, insurance, vehicle)',
  policy: 'Policies and acknowledgements',
  correspondence: 'Letters and correspondence',
  branding: 'Branding assets (logos)',
  other: 'Other',
} as const satisfies Record<string, string>;
export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;
export const DOCUMENT_CATEGORY_KEYS = Object.keys(DOCUMENT_CATEGORIES) as [
  DocumentCategory,
  ...DocumentCategory[],
];

/**
 * Upload allowlist: extension → accepted MIME types (the first one is canonical). SVG and HTML
 * are deliberately excluded (script content). The server also sniffs magic bytes.
 */
export const DOCUMENT_UPLOAD_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  txt: ['text/plain'],
};
/** Logos: raster images only (embedded into PDFs and the web theme). */
export const LOGO_UPLOAD_TYPES: Record<string, readonly string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
};
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Owner entity type code (`organization`, `institution`, `employee`, `student`…). */
export const documentOwnerTypeSchema = z
  .string()
  .trim()
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Owner type must be a lower snake_case code');

const codeLike = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[a-z][a-z0-9_]*$/, 'Must be a lower snake_case code');

export const documentFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (v) => !/[\\/]/.test(v) && ![...v].some((c) => c.charCodeAt(0) < 0x20),
    'Invalid file name',
  );

export const sha256HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Must be a hex SHA-256 digest');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** Days before expiry at which reminders are due (spec §34). */
export const reminderDaysSchema = z
  .array(z.number().int().min(0).max(365))
  .max(10)
  .transform((v) => [...new Set(v)].sort((a, b) => b - a));

/** Metadata of a NEW document (multipart field `metadata` as JSON, or the upload request). */
export const documentMetadataSchema = z
  .object({
    ownerType: documentOwnerTypeSchema.default('organization'),
    /** Omit for `organization`. */
    ownerId: idSchema.optional(),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2000).nullish(),
    category: z.enum(DOCUMENT_CATEGORY_KEYS).default('other'),
    documentType: codeLike(64).nullish(),
    confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).default('INTERNAL'),
    issueDate: isoDate.nullish(),
    expiryDate: isoDate.nullish(),
    reminderDays: reminderDaysSchema.optional(),
  })
  .strict()
  .refine((v) => !v.issueDate || !v.expiryDate || v.issueDate <= v.expiryDate, {
    message: 'expiryDate must not be before issueDate',
    path: ['expiryDate'],
  });
export type DocumentMetadataInput = z.input<typeof documentMetadataSchema>;
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

const fileDescriptor = {
  fileName: documentFileNameSchema,
  mimeType: z.string().trim().toLowerCase().max(127),
  sizeBytes: z.number().int().min(1),
  /** Optional client digest; verified on finalize. */
  checksumSha256: sha256HexSchema.optional(),
};

/** Step 1 of the signed-URL flow for a NEW document. */
export const createDocumentUploadSchema = z
  .object({ document: documentMetadataSchema, ...fileDescriptor })
  .strict();
export type CreateDocumentUploadInput = z.input<typeof createDocumentUploadSchema>;

/** Step 1 of the signed-URL flow for a NEW VERSION of an existing document. */
export const createVersionUploadSchema = z
  .object({ ...fileDescriptor, reason: z.string().trim().max(500).optional() })
  .strict();
export type CreateVersionUploadInput = z.input<typeof createVersionUploadSchema>;

/** Multipart new-version fields (besides the `file` part). */
export const versionFieldsSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2000).nullish(),
    category: z.enum(DOCUMENT_CATEGORY_KEYS).optional(),
    documentType: codeLike(64).nullish(),
    confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).optional(),
    status: z.enum(DOCUMENT_STATUSES).optional(),
    issueDate: isoDate.nullish(),
    expiryDate: isoDate.nullish(),
    reminderDays: reminderDaysSchema.optional(),
  })
  .strict();
export type UpdateDocumentInput = z.input<typeof updateDocumentSchema>;

export const documentListQuerySchema = paginationQuerySchema
  .extend({
    ownerType: documentOwnerTypeSchema.optional(),
    ownerId: idSchema.optional(),
    category: z.enum(DOCUMENT_CATEGORY_KEYS).optional(),
    documentType: codeLike(64).optional(),
    module: codeLike(50).optional(),
    confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).optional(),
    status: z.enum(DOCUMENT_STATUSES).optional(),
    groupId: idSchema.optional(),
    institutionId: idSchema.optional(),
    campusId: idSchema.optional(),
    departmentId: idSchema.optional(),
  })
  .strict();
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const expiringDocumentsQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({
    withinDays: z.coerce.number().int().min(0).max(365).default(30),
    institutionId: idSchema.optional(),
    /** Include documents that already expired. */
    includeExpired: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .strict();
export type ExpiringDocumentsQuery = z.infer<typeof expiringDocumentsQuerySchema>;

export const downloadUrlSchema = z
  .object({
    versionId: idSchema.optional(),
    disposition: z.enum(['attachment', 'inline']).default('attachment'),
  })
  .strict();
export type DownloadUrlInput = z.input<typeof downloadUrlSchema>;

export const restoreVersionSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const deleteDocumentQuerySchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const DOCUMENT_GRANTEE_TYPES = ['USER', 'ROLE', 'SCOPE'] as const;
export type DocumentGranteeType = (typeof DOCUMENT_GRANTEE_TYPES)[number];

export const createDocumentGrantSchema = z
  .object({
    granteeType: z.enum(DOCUMENT_GRANTEE_TYPES),
    userId: idSchema.optional(),
    roleKey: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    scopeType: z.enum(SCOPE_TYPES).optional(),
    scopeId: idSchema.optional(),
    actions: z.array(z.enum(DOCUMENT_ACTIONS)).min(1),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.granteeType === 'USER' && !v.userId) issue('userId', 'Required for USER grants');
    if (v.granteeType === 'ROLE' && !v.roleKey) issue('roleKey', 'Required for ROLE grants');
    if (v.granteeType === 'SCOPE') {
      if (!v.scopeType) issue('scopeType', 'Required for SCOPE grants');
      else if (v.scopeType !== 'ORGANIZATION' && !v.scopeId) {
        issue('scopeId', 'Required unless scopeType is ORGANIZATION');
      }
    }
  });
export type CreateDocumentGrantInput = z.input<typeof createDocumentGrantSchema>;

export const createSignatureRequestSchema = z
  .object({
    versionId: idSchema.optional(),
    signerUserId: idSchema.optional(),
    signerName: z.string().trim().min(1).max(200),
    signerEmail: z.string().trim().email().max(200).optional(),
    signerRole: z.string().trim().max(100).optional(),
    signingOrder: z.number().int().min(1).max(50).default(1),
  })
  .strict();
export type CreateSignatureRequestInput = z.input<typeof createSignatureRequestSchema>;

export const updateSignatureSchema = z
  .object({
    status: z.enum(['SENT', 'SIGNED', 'DECLINED', 'CANCELLED']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type UpdateSignatureInput = z.infer<typeof updateSignatureSchema>;

export const documentVersionParamsSchema = z.object({ id: idSchema, versionId: idSchema });
export const documentSubParamsSchema = z.object({ id: idSchema, subId: idSchema });
export const uploadIdParamsSchema = z.object({ uploadId: idSchema });

/** Optional finalize body for the signed-URL flow. */
export const completeUploadSchema = z
  .object({ checksumSha256: sha256HexSchema.optional() })
  .strict();

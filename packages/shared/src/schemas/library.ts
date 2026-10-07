import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const money = z.coerce.number().min(0).max(1_000_000);

export const LIBRARY_ITEM_TYPES = ['BOOK', 'JOURNAL', 'MAGAZINE', 'E_RESOURCE', 'OTHER'] as const;
export const libraryItemTypeSchema = z.enum(LIBRARY_ITEM_TYPES);
export type LibraryItemType = z.infer<typeof libraryItemTypeSchema>;

export const LIBRARY_COPY_STATUSES = [
  'AVAILABLE',
  'ISSUED',
  'RESERVED',
  'LOST',
  'DAMAGED',
  'WITHDRAWN',
] as const;
export const libraryCopyStatusSchema = z.enum(LIBRARY_COPY_STATUSES);
export type LibraryCopyStatus = z.infer<typeof libraryCopyStatusSchema>;

export const LIBRARY_MEMBER_TYPES = ['STUDENT', 'EMPLOYEE'] as const;
export const libraryMemberTypeSchema = z.enum(LIBRARY_MEMBER_TYPES);
export type LibraryMemberType = z.infer<typeof libraryMemberTypeSchema>;

export const LIBRARY_LOAN_STATUSES = ['ISSUED', 'RETURNED', 'LOST'] as const;
export const libraryLoanStatusSchema = z.enum(LIBRARY_LOAN_STATUSES);
export type LibraryLoanStatus = z.infer<typeof libraryLoanStatusSchema>;

export const LIBRARY_RESERVATION_STATUSES = [
  'WAITING',
  'READY',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const libraryReservationStatusSchema = z.enum(LIBRARY_RESERVATION_STATUSES);
export type LibraryReservationStatus = z.infer<typeof libraryReservationStatusSchema>;

export const LIBRARY_FINE_REASONS = ['OVERDUE', 'LOST', 'DAMAGED'] as const;
export const libraryFineReasonSchema = z.enum(LIBRARY_FINE_REASONS);
export type LibraryFineReason = z.infer<typeof libraryFineReasonSchema>;

export const LIBRARY_FINE_STATUSES = ['PENDING', 'COLLECTED', 'WAIVED', 'POSTED'] as const;
export const libraryFineStatusSchema = z.enum(LIBRARY_FINE_STATUSES);
export type LibraryFineStatus = z.infer<typeof libraryFineStatusSchema>;

export const LIBRARY_RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'LOST'] as const;
export const libraryReturnConditionSchema = z.enum(LIBRARY_RETURN_CONDITIONS);

export const LIBRARY_REPORTS = ['issued', 'overdue', 'most_borrowed', 'fines'] as const;
export const libraryReportKeySchema = z.enum(LIBRARY_REPORTS);
export type LibraryReportKey = z.infer<typeof libraryReportKeySchema>;

const stringList = z.array(text(120).min(1)).max(20);

/* ------------------------------------ Catalogue ------------------------------------------ */

const bookFields = {
  itemType: libraryItemTypeSchema.default('BOOK'),
  isbn: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9Xx-]{8,20}$/, 'Invalid ISBN/ISSN')
    .nullish(),
  title: text(300).min(1),
  subtitle: optionalText(300),
  authors: stringList.default([]),
  publisher: optionalText(200),
  edition: optionalText(60),
  publicationYear: z.coerce.number().int().min(1000).max(2100).nullish(),
  category: optionalText(100),
  language: optionalText(40),
  tags: stringList.default([]),
  callNumber: optionalText(60),
  url: z.string().trim().url().max(500).nullish(),
  description: optionalText(2000),
};

export const createLibraryBookSchema = z
  .object({
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    ...bookFields,
    /** Optionally create N copies right away (accession numbers auto-assigned). */
    copies: z.coerce.number().int().min(0).max(100).default(0),
    shelf: optionalText(40),
    rack: optionalText(40),
  })
  .strict();
export type CreateLibraryBookInput = z.infer<typeof createLibraryBookSchema>;

export const updateLibraryBookSchema = z
  .object({
    campusId: idSchema.nullish(),
    itemType: libraryItemTypeSchema.optional(),
    isbn: bookFields.isbn,
    title: text(300).min(1).optional(),
    subtitle: bookFields.subtitle,
    authors: stringList.optional(),
    publisher: bookFields.publisher,
    edition: bookFields.edition,
    publicationYear: bookFields.publicationYear,
    category: bookFields.category,
    language: bookFields.language,
    tags: stringList.optional(),
    callNumber: bookFields.callNumber,
    url: bookFields.url,
    description: bookFields.description,
  })
  .strict();
export type UpdateLibraryBookInput = z.infer<typeof updateLibraryBookSchema>;

export const listLibraryBooksQuerySchema = paginationQuerySchema
  .extend({
    groupId: idSchema.optional(),
    institutionId: idSchema.optional(),
    campusId: idSchema.optional(),
    itemType: libraryItemTypeSchema.optional(),
    category: text(100).optional(),
    language: text(40).optional(),
    availableOnly: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListLibraryBooksQuery = z.infer<typeof listLibraryBooksQuerySchema>;

/* ------------------------------------- Copies -------------------------------------------- */

export const createLibraryCopiesSchema = z
  .object({
    bookId: idSchema,
    count: z.coerce.number().int().min(1).max(100).default(1),
    /** Explicit accession numbers / barcodes (defaults: auto-generated). */
    accessionNos: z.array(text(40).min(1)).max(100).optional(),
    shelf: optionalText(40),
    rack: optionalText(40),
    condition: optionalText(40),
    price: money.nullish(),
    acquiredOn: isoDateSchema.nullish(),
  })
  .strict();
export type CreateLibraryCopiesInput = z.infer<typeof createLibraryCopiesSchema>;

export const updateLibraryCopySchema = z
  .object({
    shelf: optionalText(40),
    rack: optionalText(40),
    condition: optionalText(40),
    price: money.nullish(),
    acquiredOn: isoDateSchema.nullish(),
    notes: optionalText(500),
    /** Only non-circulation statuses can be set manually. */
    status: z.enum(['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN']).optional(),
  })
  .strict();
export type UpdateLibraryCopyInput = z.infer<typeof updateLibraryCopySchema>;

export const listLibraryCopiesQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    bookId: idSchema.optional(),
    status: libraryCopyStatusSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListLibraryCopiesQuery = z.infer<typeof listLibraryCopiesQuerySchema>;

export const libraryLabelsSchema = z
  .object({
    copyIds: z.array(idSchema).min(1).max(500).optional(),
    bookId: idSchema.optional(),
    institutionId: idSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.copyIds || v.bookId || v.institutionId,
    'Provide copyIds, bookId or institutionId',
  );
export type LibraryLabelsInput = z.infer<typeof libraryLabelsSchema>;

/* ------------------------------------- Policies ------------------------------------------ */

export const upsertLibraryPolicySchema = z
  .object({
    institutionId: idSchema,
    memberType: libraryMemberTypeSchema,
    maxBooks: z.coerce.number().int().min(0).max(50),
    loanDays: z.coerce.number().int().min(1).max(365),
    maxRenewals: z.coerce.number().int().min(0).max(20),
    finePerDay: money,
    maxFine: money,
    holdDays: z.coerce.number().int().min(1).max(30).default(3),
  })
  .strict();
export type UpsertLibraryPolicyInput = z.infer<typeof upsertLibraryPolicySchema>;

export const libraryInstitutionQuerySchema = z
  .object({ institutionId: idSchema.optional() })
  .strict();
export type LibraryInstitutionQuery = z.infer<typeof libraryInstitutionQuerySchema>;

/* ----------------------------------- Circulation ----------------------------------------- */

const memberRef = {
  studentId: idSchema.optional(),
  employeeId: idSchema.optional(),
};
const oneMember = (v: { studentId?: string; employeeId?: string }) =>
  Boolean(v.studentId) !== Boolean(v.employeeId);

export const issueLibraryCopySchema = z
  .object({
    barcode: text(64).min(1).optional(),
    copyId: idSchema.optional(),
    ...memberRef,
    dueDate: isoDateSchema.optional(),
    /** Back-dated issue (data migration / demo); requires library.manage. */
    issuedAt: isoDateSchema.optional(),
  })
  .strict()
  .refine((v) => v.barcode || v.copyId, 'Provide barcode or copyId')
  .refine(oneMember, 'Provide exactly one of studentId or employeeId');
export type IssueLibraryCopyInput = z.infer<typeof issueLibraryCopySchema>;

export const returnLibraryCopySchema = z
  .object({
    barcode: text(64).min(1).optional(),
    loanId: idSchema.optional(),
    condition: libraryReturnConditionSchema.default('GOOD'),
    /** Extra charge for damaged / lost copies (defaults to copy price for LOST). */
    damageCharge: money.optional(),
    /** Back-dated return (data migration / demo); requires library.manage. */
    returnedAt: isoDateSchema.optional(),
  })
  .strict()
  .refine((v) => v.barcode || v.loanId, 'Provide barcode or loanId');
export type ReturnLibraryCopyInput = z.infer<typeof returnLibraryCopySchema>;

export const renewLibraryLoanSchema = z.object({ dueDate: isoDateSchema.optional() }).strict();
export type RenewLibraryLoanInput = z.infer<typeof renewLibraryLoanSchema>;

export const listLibraryLoansQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: libraryLoanStatusSchema.optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    studentId: idSchema.optional(),
    employeeId: idSchema.optional(),
    bookId: idSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListLibraryLoansQuery = z.infer<typeof listLibraryLoansQuerySchema>;

export const createLibraryReservationSchema = z
  .object({ bookId: idSchema, ...memberRef })
  .strict()
  .refine(oneMember, 'Provide exactly one of studentId or employeeId');
export type CreateLibraryReservationInput = z.infer<typeof createLibraryReservationSchema>;

/** Self-service reservation: member is the caller (or a ward for parents). */
export const reserveOwnSchema = z
  .object({ bookId: idSchema, studentId: idSchema.optional() })
  .strict();
export type ReserveOwnInput = z.infer<typeof reserveOwnSchema>;

export const listLibraryReservationsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: libraryReservationStatusSchema.optional(),
    bookId: idSchema.optional(),
  })
  .strict();
export type ListLibraryReservationsQuery = z.infer<typeof listLibraryReservationsQuerySchema>;

/* -------------------------------------- Fines -------------------------------------------- */

export const listLibraryFinesQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: libraryFineStatusSchema.optional(),
    studentId: idSchema.optional(),
    employeeId: idSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListLibraryFinesQuery = z.infer<typeof listLibraryFinesQuerySchema>;

export const settleLibraryFineSchema = z.object({ note: optionalText(500) }).strict();
export type SettleLibraryFineInput = z.infer<typeof settleLibraryFineSchema>;

/* ------------------------------------- Members ------------------------------------------- */

export const listLibraryMembersQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    memberType: libraryMemberTypeSchema.default('STUDENT'),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListLibraryMembersQuery = z.infer<typeof listLibraryMembersQuerySchema>;

/* ------------------------------ Stock verification / reports ----------------------------- */

export const createStockVerificationSchema = z
  .object({ institutionId: idSchema, name: text(200).min(1) })
  .strict();
export type CreateStockVerificationInput = z.infer<typeof createStockVerificationSchema>;

export const scanStockVerificationSchema = z
  .object({ barcodes: z.array(text(64).min(1)).min(1).max(2000) })
  .strict();
export type ScanStockVerificationInput = z.infer<typeof scanStockVerificationSchema>;

export const libraryReportQuerySchema = z
  .object({
    institutionId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    format: z.enum(['json', 'csv', 'xlsx']).default('json'),
    limit: z.coerce.number().int().min(1).max(5000).default(1000),
  })
  .strict();
export type LibraryReportQuery = z.infer<typeof libraryReportQuerySchema>;

export const opacSearchQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    itemType: libraryItemTypeSchema.optional(),
    category: text(100).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type OpacSearchQuery = z.infer<typeof opacSearchQuerySchema>;

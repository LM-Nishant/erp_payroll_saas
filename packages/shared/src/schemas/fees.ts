import { z } from 'zod';
import { codeSchema, idSchema, nameSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
/** Money in rupees with at most 2 decimals. */
export const moneySchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(999_999_999_999)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals');
const positiveMoney = moneySchema.refine((v) => v > 0, 'Must be greater than 0');
export const academicYearSchema = text(9).regex(/^\d{4}-\d{2}$/, 'Must look like 2026-27');

export const FEE_HEAD_CATEGORIES = [
  'TUITION',
  'TRANSPORT',
  'HOSTEL',
  'LIBRARY',
  'EXAM',
  'ADMISSION',
  'MISC',
] as const;
export const feeHeadCategorySchema = z.enum(FEE_HEAD_CATEGORIES);
export type FeeHeadCategory = z.infer<typeof feeHeadCategorySchema>;

export const createFeeHeadSchema = z
  .object({
    institutionId: idSchema.nullish(),
    code: codeSchema,
    name: nameSchema,
    category: feeHeadCategorySchema.default('MISC'),
    refundable: z.boolean().default(false),
    taxRate: z.coerce.number().min(0).max(100).default(0),
    incomeAccountId: idSchema.nullish(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateFeeHeadInput = z.infer<typeof createFeeHeadSchema>;
export const updateFeeHeadSchema = createFeeHeadSchema
  .omit({ institutionId: true, code: true })
  .partial()
  .strict();
export type UpdateFeeHeadInput = z.infer<typeof updateFeeHeadSchema>;
export const listFeeHeadsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    category: feeHeadCategorySchema.optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const LATE_FEE_MODES = ['FLAT', 'PER_DAY'] as const;
export const lateFeeModeSchema = z.enum(LATE_FEE_MODES);
export type LateFeeMode = z.infer<typeof lateFeeModeSchema>;
export const createLateRuleSchema = z
  .object({
    institutionId: idSchema,
    name: nameSchema,
    mode: lateFeeModeSchema,
    amount: positiveMoney,
    graceDays: z.coerce.number().int().min(0).max(365).default(0),
    maxAmount: moneySchema.nullish(),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateLateRuleInput = z.infer<typeof createLateRuleSchema>;
export const updateLateRuleSchema = createLateRuleSchema
  .omit({ institutionId: true })
  .partial()
  .strict();
export type UpdateLateRuleInput = z.infer<typeof updateLateRuleSchema>;

export const FEE_STRUCTURE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const feeStructureStatusSchema = z.enum(FEE_STRUCTURE_STATUSES);
export const feeInstallmentInputSchema = z
  .object({
    label: text(120).min(1),
    dueDate: isoDateSchema,
    items: z
      .array(z.object({ feeHeadId: idSchema, amount: moneySchema }).strict())
      .min(1)
      .max(50),
  })
  .strict();
export type FeeInstallmentInput = z.infer<typeof feeInstallmentInputSchema>;
export const createFeeStructureSchema = z
  .object({
    institutionId: idSchema,
    programId: idSchema.nullish(),
    classSectionId: idSchema.nullish(),
    academicYear: academicYearSchema,
    code: codeSchema,
    name: nameSchema,
    status: feeStructureStatusSchema.default('ACTIVE'),
    lateRuleId: idSchema.nullish(),
    notes: optionalText(1000),
    installments: z.array(feeInstallmentInputSchema).min(1).max(24),
  })
  .strict();
export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>;
export const updateFeeStructureSchema = createFeeStructureSchema
  .omit({ institutionId: true, academicYear: true, code: true })
  .partial()
  .strict();
export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;
export const listFeeStructuresQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    academicYear: academicYearSchema.optional(),
    classSectionId: idSchema.optional(),
    programId: idSchema.optional(),
    status: feeStructureStatusSchema.optional(),
  })
  .strict();

export const CONCESSION_KINDS = ['CONCESSION', 'SCHOLARSHIP', 'SIBLING'] as const;
export const concessionKindSchema = z.enum(CONCESSION_KINDS);
export const CONCESSION_TARGETS = ['STUDENT', 'CATEGORY', 'SIBLING'] as const;
export const concessionTargetSchema = z.enum(CONCESSION_TARGETS);
export const CONCESSION_VALUE_TYPES = ['PERCENT', 'AMOUNT'] as const;
export const concessionValueTypeSchema = z.enum(CONCESSION_VALUE_TYPES);
export type ConcessionValueType = z.infer<typeof concessionValueTypeSchema>;
export const createConcessionSchema = z
  .object({
    institutionId: idSchema.optional(),
    name: nameSchema,
    kind: concessionKindSchema.default('CONCESSION'),
    appliesTo: concessionTargetSchema,
    studentId: idSchema.nullish(),
    category: optionalText(64),
    feeHeadId: idSchema.nullish(),
    valueType: concessionValueTypeSchema,
    value: positiveMoney,
    academicYear: academicYearSchema.nullish(),
    reason: optionalText(500),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.appliesTo !== 'STUDENT' || v.studentId, {
    message: 'studentId is required for a student concession',
    path: ['studentId'],
  })
  .refine((v) => v.appliesTo !== 'CATEGORY' || v.category, {
    message: 'category is required for a category concession',
    path: ['category'],
  })
  .refine((v) => v.appliesTo === 'STUDENT' || v.institutionId, {
    message: 'institutionId is required',
    path: ['institutionId'],
  })
  .refine((v) => v.valueType !== 'PERCENT' || v.value <= 100, {
    message: 'Percent must be ≤ 100',
    path: ['value'],
  });
export type CreateConcessionInput = z.infer<typeof createConcessionSchema>;
export const updateConcessionSchema = z
  .object({
    name: nameSchema.optional(),
    valueType: concessionValueTypeSchema.optional(),
    value: positiveMoney.optional(),
    reason: optionalText(500),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateConcessionInput = z.infer<typeof updateConcessionSchema>;
export const listConcessionsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    studentId: idSchema.optional(),
    appliesTo: concessionTargetSchema.optional(),
  })
  .strict();

export const generateInvoicesSchema = z
  .object({
    structureId: idSchema,
    classSectionId: idSchema.optional(),
    studentIds: z.array(idSchema).max(2000).optional(),
    installmentIds: z.array(idSchema).max(24).optional(),
    issueDate: isoDateSchema.optional(),
  })
  .strict();
export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

export const createAdhocInvoiceSchema = z
  .object({
    studentId: idSchema,
    dueDate: isoDateSchema,
    description: optionalText(500),
    lines: z
      .array(
        z
          .object({
            feeHeadId: idSchema,
            amount: positiveMoney,
            description: optionalText(500),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type CreateAdhocInvoiceInput = z.infer<typeof createAdhocInvoiceSchema>;

export const studentChargeSchema = z
  .object({
    studentId: idSchema,
    feeHeadCode: codeSchema,
    amount: positiveMoney,
    dueDate: isoDateSchema,
    sourceType: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Use UPPER_SNAKE_CASE'),
    sourceId: text(64).min(1).nullish(),
    description: optionalText(500),
  })
  .strict();
export type StudentChargeInput = z.infer<typeof studentChargeSchema>;

export const FEE_INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
export const feeInvoiceStatusSchema = z.enum(FEE_INVOICE_STATUSES);
export type FeeInvoiceStatus = z.infer<typeof feeInvoiceStatusSchema>;
export const listFeeInvoicesQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    studentId: idSchema.optional(),
    status: feeInvoiceStatusSchema.optional(),
    open: z.enum(['true', 'false']).optional(),
    academicYear: academicYearSchema.optional(),
    overdue: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const feeCancelSchema = z.object({ reason: text(500).min(3) }).strict();
export type FeeCancelInput = z.infer<typeof feeCancelSchema>;

/** Historic receipts may carry any mode; new money is received via UPI only. */
export const PAYMENT_MODES = ['CASH', 'CHEQUE', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE'] as const;
export const paymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof paymentModeSchema>;
/** Modes accepted for new receipts and refunds. */
export const UPI_ONLY_MODES = ['UPI'] as const;
const upiModeSchema = z.enum(UPI_ONLY_MODES).default('UPI');

/** UPI transaction reference (UTR / RRN) shown in the payer's UPI app. */
export const utrSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{6,64}$/, 'Enter the UPI transaction reference (UTR)');
/** UPI VPA, e.g. `school@okhdfcbank`. */
export const upiIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/, 'Enter a valid UPI ID (name@bank)');

export const recordPaymentSchema = z
  .object({
    studentId: idSchema,
    amount: positiveMoney,
    paidOn: isoDateSchema.optional(),
    mode: upiModeSchema,
    /** UTR of the UPI transfer received at the counter. */
    reference: utrSchema,
    remarks: optionalText(500),
    /** Explicit allocation; omitted = oldest-due-first across the student's open invoices. */
    allocations: z
      .array(z.object({ invoiceId: idSchema, amount: positiveMoney }).strict())
      .max(100)
      .optional(),
  })
  .strict();
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export const listPaymentsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    studentId: idSchema.optional(),
    mode: paymentModeSchema.optional(),
    status: z.enum(['ACTIVE', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export const refundPaymentSchema = z
  .object({
    amount: positiveMoney,
    mode: upiModeSchema,
    /** UTR of the UPI transfer sent back to the payer. */
    reference: utrSchema,
    refundedOn: isoDateSchema.optional(),
    reason: text(500).min(3),
  })
  .strict();
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

/* ------------------------------------ UPI collection ------------------------------------ */

export const feeUpiSettingSchema = z
  .object({
    institutionId: idSchema,
    upiId: upiIdSchema,
    payeeName: text(100).min(2),
    active: z.boolean().default(true),
  })
  .strict();
export type FeeUpiSettingInput = z.infer<typeof feeUpiSettingSchema>;
export const feeUpiSettingsQuerySchema = z.object({ institutionId: idSchema.optional() }).strict();

/** Student / parent asks for the UPI QR of selected invoices. */
export const upiIntentSchema = z
  .object({
    studentId: idSchema,
    invoiceIds: z.array(idSchema).min(1).max(50),
  })
  .strict();
export type UpiIntentInput = z.infer<typeof upiIntentSchema>;
/** Student / parent reports a completed UPI transfer (verified by the accountant). */
export const submitUpiPaymentSchema = upiIntentSchema
  .extend({
    utr: utrSchema,
    paidOn: isoDateSchema.optional(),
    remarks: optionalText(500),
  })
  .strict();
export type SubmitUpiPaymentInput = z.infer<typeof submitUpiPaymentSchema>;
export const UPI_PAYMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export const upiPaymentStatusSchema = z.enum(UPI_PAYMENT_STATUSES);
export type UpiPaymentStatus = z.infer<typeof upiPaymentStatusSchema>;
export const listUpiPaymentsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    studentId: idSchema.optional(),
    status: upiPaymentStatusSchema.optional(),
  })
  .strict();
export const rejectUpiPaymentSchema = z.object({ reason: text(500).min(3) }).strict();
export type RejectUpiPaymentInput = z.infer<typeof rejectUpiPaymentSchema>;

export const defaultersQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    asOf: isoDateSchema.optional(),
    minDays: z.coerce.number().int().min(0).max(3650).default(1),
  })
  .strict();
export const sendRemindersSchema = z
  .object({
    institutionId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    minDays: z.coerce.number().int().min(0).max(3650).default(1),
  })
  .strict();
export type SendRemindersInput = z.infer<typeof sendRemindersSchema>;

export const FEE_REPORTS = ['collections', 'dues', 'aging', 'head_wise', 'concessions'] as const;
export const feeReportSchema = z.enum(FEE_REPORTS);
export type FeeReportKey = z.infer<typeof feeReportSchema>;
export const feeReportQuerySchema = z
  .object({
    institutionId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  })
  .strict();

export const updateNumberSeriesSchema = z
  .object({
    institutionId: idSchema,
    kind: z.enum(['INVOICE', 'RECEIPT', 'REFUND', 'VOUCHER', 'EXPENSE']),
    prefix: text(24).min(1),
    nextValue: z.coerce.number().int().min(1).optional(),
    padding: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();
export type UpdateNumberSeriesInput = z.infer<typeof updateNumberSeriesSchema>;

import { z } from 'zod';
import { codeSchema, idSchema, nameSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';
import { moneySchema, paymentModeSchema } from './fees';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const createAccountSchema = z
  .object({
    parentId: idSchema.nullish(),
    code: codeSchema,
    name: nameSchema,
    type: accountTypeSchema,
    isGroup: z.boolean().default(false),
    description: optionalText(500),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export const updateAccountSchema = z
  .object({
    name: nameSchema.optional(),
    description: optionalText(500),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const VOUCHER_TYPES = ['JOURNAL', 'RECEIPT', 'PAYMENT', 'CONTRA'] as const;
export const voucherTypeSchema = z.enum(VOUCHER_TYPES);
export type VoucherType = z.infer<typeof voucherTypeSchema>;
export const VOUCHER_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
export const voucherStatusSchema = z.enum(VOUCHER_STATUSES);
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;

export const voucherLineInputSchema = z
  .object({
    accountId: idSchema,
    debit: moneySchema.default(0),
    credit: moneySchema.default(0),
    narration: optionalText(500),
  })
  .strict()
  .refine((l) => l.debit > 0 !== l.credit > 0, 'Each line needs either a debit or a credit');
export type VoucherLineInput = z.infer<typeof voucherLineInputSchema>;

export const createVoucherSchema = z
  .object({
    institutionId: idSchema,
    voucherDate: isoDateSchema,
    type: voucherTypeSchema.default('JOURNAL'),
    narration: optionalText(1000),
    lines: z.array(voucherLineInputSchema).min(2).max(200),
    post: z.boolean().default(false),
  })
  .strict();
export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;
export const listVouchersQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: voucherStatusSchema.optional(),
    type: voucherTypeSchema.optional(),
    sourceType: z.string().trim().max(32).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();

export const createVendorSchema = z
  .object({
    institutionId: idSchema.nullish(),
    code: codeSchema,
    name: nameSchema,
    gstin: optionalText(20),
    phone: optionalText(32),
    email: z.string().trim().email().max(254).nullish(),
    address: optionalText(500),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export const updateVendorSchema = createVendorSchema
  .omit({ code: true, institutionId: true })
  .partial()
  .strict();
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const createExpenseSchema = z
  .object({
    institutionId: idSchema,
    expenseDate: isoDateSchema,
    vendorId: idSchema.nullish(),
    expenseAccountId: idSchema,
    paymentAccountId: idSchema.optional(),
    amount: moneySchema.refine((v) => v > 0, 'Must be greater than 0'),
    mode: paymentModeSchema,
    reference: optionalText(120),
    description: text(500).min(1),
  })
  .strict();
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export const listExpensesQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    vendorId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();

export const FINANCE_REPORTS = [
  'day_book',
  'ledger',
  'trial_balance',
  'income_expenditure',
] as const;
export const financeReportSchema = z.enum(FINANCE_REPORTS);
export type FinanceReportKey = z.infer<typeof financeReportSchema>;
export const financeReportQuerySchema = z
  .object({
    institutionId: idSchema.optional(),
    accountId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  })
  .strict();

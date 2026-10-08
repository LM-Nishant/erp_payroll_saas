import type { FeeHeadCategory, FeeInvoiceStatus, PaymentMode } from '../schemas/fees';
import type { AccountType, VoucherStatus, VoucherType } from '../schemas/finance';

interface Ref {
  id: string;
  name: string;
  code?: string;
}

export interface FeeHeadDto {
  id: string;
  institutionId: string | null;
  code: string;
  name: string;
  category: FeeHeadCategory;
  refundable: boolean;
  taxRate: number;
  incomeAccountId: string | null;
  sortOrder: number;
  active: boolean;
}

export interface FeeLateRuleDto {
  id: string;
  institutionId: string;
  name: string;
  mode: 'FLAT' | 'PER_DAY';
  amount: number;
  graceDays: number;
  maxAmount: number | null;
  active: boolean;
}

export interface FeeStructureDto {
  id: string;
  institutionId: string;
  programId: string | null;
  classSectionId: string | null;
  academicYear: string;
  code: string;
  name: string;
  status: string;
  lateRuleId: string | null;
  totalAmount: number;
  notes: string | null;
  installments?: Array<{
    id: string;
    seq: number;
    label: string;
    dueDate: string;
    total: number;
    items: Array<{ id: string; feeHeadId: string; feeHeadName?: string; amount: number }>;
  }>;
}

export interface FeeConcessionDto {
  id: string;
  institutionId: string;
  name: string;
  kind: string;
  appliesTo: 'STUDENT' | 'CATEGORY' | 'SIBLING';
  studentId: string | null;
  studentName?: string | null;
  category: string | null;
  feeHeadId: string | null;
  valueType: 'PERCENT' | 'AMOUNT';
  value: number;
  academicYear: string | null;
  reason: string | null;
  active: boolean;
}

export interface FeeInvoiceLineDto {
  id: string;
  feeHeadId: string;
  feeHeadName?: string;
  description: string | null;
  amount: number;
  concessionAmount: number;
  taxAmount: number;
  netAmount: number;
}

export interface FeeInvoiceDto {
  id: string;
  number: string;
  institutionId: string;
  classSectionId: string | null;
  studentId: string;
  student?: { id: string; displayName: string; admissionNo: string } | null;
  academicYear: string | null;
  structureId: string | null;
  installmentId: string | null;
  sourceType: string;
  sourceId: string | null;
  description: string | null;
  issueDate: string;
  dueDate: string;
  grossAmount: number;
  concessionAmount: number;
  taxAmount: number;
  lateFeeAmount: number;
  netAmount: number;
  paidAmount: number;
  balance: number;
  status: FeeInvoiceStatus;
  cancelReason: string | null;
  lines?: FeeInvoiceLineDto[];
}

export interface FeePaymentDto {
  id: string;
  number: string;
  institutionId: string;
  studentId: string;
  student?: { id: string; displayName: string; admissionNo: string } | null;
  paidOn: string;
  mode: PaymentMode;
  reference: string | null;
  amount: number;
  allocatedAmount: number;
  refundedAmount: number;
  status: string;
  remarks: string | null;
  cancelReason: string | null;
  voucherId: string | null;
  allocations?: Array<{ invoiceId: string; invoiceNumber?: string; amount: number }>;
  refunds?: Array<{
    id: string;
    number: string;
    amount: number;
    refundedOn: string;
    reason: string;
  }>;
}

export interface StudentFeeSummaryDto {
  student: { id: string; displayName: string; admissionNo: string; classSection?: Ref | null };
  totals: { billed: number; paid: number; balance: number; overdue: number };
  invoices: FeeInvoiceDto[];
  payments: FeePaymentDto[];
  onlinePaymentEnabled: boolean;
}

export interface DefaulterDto {
  studentId: string;
  displayName: string;
  admissionNo: string;
  classSectionId: string | null;
  classSectionName: string | null;
  invoiceCount: number;
  balance: number;
  oldestDueDate: string;
  daysOverdue: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
}

export interface CheckoutDto {
  orderId: string;
  provider: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  /** Mock gateway only: values the hosted page would return (used to simulate success). */
  test?: { paymentId: string; signature: string };
}

export interface LedgerAccountDto {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  type: AccountType;
  isGroup: boolean;
  systemKey: string | null;
  description: string | null;
  active: boolean;
}

export interface JournalVoucherDto {
  id: string;
  institutionId: string;
  number: string;
  voucherDate: string;
  type: VoucherType;
  narration: string | null;
  status: VoucherStatus;
  totalAmount: number;
  sourceType: string;
  sourceId: string | null;
  cancelReason: string | null;
  lines?: Array<{
    id: string;
    accountId: string;
    accountCode?: string;
    accountName?: string;
    debit: number;
    credit: number;
    narration: string | null;
  }>;
}

export interface VendorDto {
  id: string;
  institutionId: string | null;
  code: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}

export interface ExpenseDto {
  id: string;
  institutionId: string;
  number: string;
  expenseDate: string;
  vendorId: string | null;
  vendorName?: string | null;
  expenseAccountId: string;
  expenseAccountName?: string | null;
  paymentAccountId: string;
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  description: string;
  status: string;
  voucherId: string | null;
}

/** Generic tabular report payload (JSON form of CSV/XLSX/PDF exports). */
export interface FinanceTableDto {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

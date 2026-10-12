import { z } from 'zod';
import { registerEventType } from '../../core/events';
import { currentFeatureContext, isFeatureEnabled } from '../../core/features';
import {
  defineJob,
  defineRecurringJob,
  enqueue,
  forEachActiveOrganization,
} from '../../core/queue';
import { registerNotificationEvent } from '../../core/notifications';
import { registerPdfTemplate } from '../../core/pdf';
import { registerLibraryFinePoster } from '../library/library.constants';
import { registerStudentDuesProvider } from '../students/students.hooks';
import { registerStudentChargePoster } from '../transport/charges-hook';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { today } from '../finance/finance.mappers';
import { tenantDb } from '../../core/tenancy';
import { applyLateFees, sendDueReminders } from './fees.dues.service';
import { cancelStudentCharge, createStudentCharge } from './fees.invoices.service';
import { FEE_RECEIPT_TEMPLATE } from './fees.payments.service';

/*
 * Fees registrations — imported once from `apps/api/src/engines.ts`: event types, notification
 * events, the branded `fee_receipt` PDF template and the daily late-fee / due-reminder job.
 */

const EVENTS: [string, string][] = [
  ['fee.invoice_created', 'Fee invoice / charge created'],
  ['fee.invoices_generated', 'Fee invoices generated from a structure'],
  ['fee.invoice_cancelled', 'Fee invoice cancelled'],
  ['fee.payment_received', 'Fee payment received'],
  ['fee.payment_cancelled', 'Fee payment cancelled'],
  ['fee.refund_issued', 'Fee refund issued'],
];
for (const [key, label] of EVENTS) registerEventType({ key, label, webhook: true });

const NOTIFICATIONS: [string, string][] = [
  ['fee.payment_received', 'Fee payment received (receipt)'],
  ['fee.due_reminder', 'Fee due reminder'],
];
for (const [key, label] of NOTIFICATIONS) {
  registerNotificationEvent({ key, label, defaultChannels: ['in_app', 'email'] });
}

registerPdfTemplate({
  key: FEE_RECEIPT_TEMPLATE,
  version: 1,
  name: 'Fee receipt',
  description: 'Branded fee payment receipt with invoice allocations.',
  inputSchema: z
    .object({
      receiptNo: z.string(),
      date: z.string(),
      institution: z.string(),
      studentName: z.string(),
      admissionNo: z.string(),
      classSection: z.string(),
      mode: z.string(),
      reference: z.string(),
      amount: z.string(),
      allocations: z.array(z.array(z.string())),
      advance: z.string(),
      status: z.string(),
      refunded: z.string(),
    })
    .strict(),
  defaultCategory: 'student',
  defaultDocumentType: 'fee_receipt',
  title: (i) => `Fee receipt ${i.receiptNo}`,
  build: (i) => [
    { type: 'heading', level: 1, text: 'Fee receipt' },
    { type: 'paragraph', text: i.institution },
    {
      type: 'keyValue',
      rows: [
        ['Receipt no.', i.receiptNo],
        ['Date', i.date],
        ['Student', i.studentName],
        ['Admission no.', i.admissionNo],
        ['Class / section', i.classSection || '-'],
        ['Payment mode', i.mode],
        ['Reference', i.reference || '-'],
        ['Amount received', i.amount],
        ['Status', i.status],
      ],
    },
    ...(i.allocations.length
      ? [
          { type: 'heading' as const, level: 2 as const, text: 'Allocated to invoices' },
          { type: 'table' as const, columns: ['Invoice', 'Amount'], rows: i.allocations },
        ]
      : []),
    {
      type: 'keyValue',
      rows: [
        ['Advance (unallocated)', i.advance],
        ['Refunded', i.refunded],
      ],
    },
    { type: 'spacer' },
    { type: 'paragraph', text: 'This is a computer-generated receipt.' },
    { type: 'signature', label: 'Authorised signatory' },
  ],
});

/* ---- jobs ---- */
const DAY = 24 * 60 * 60 * 1000;

/** Daily per-organization: top up late fees on overdue invoices and send due reminders. */
export const FEES_DAILY_JOB = 'fees.daily_org';
defineJob<{ organizationId: string }>({
  name: FEES_DAILY_JOB,
  attempts: 3,
  handler: async () => {
    if (!(await isFeatureEnabled(currentFeatureContext(), 'finance'))) return;
    await applyLateFees();
    await sendDueReminders({ minDays: 1 }, { system: true });
  },
});

defineRecurringJob({
  name: 'fees.daily.schedule',
  everyMs: DAY,
  handler: async () => {
    const bucket = Math.floor(Date.now() / DAY);
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(
        FEES_DAILY_JOB,
        { organizationId },
        { jobId: `${FEES_DAILY_JOB}:${organizationId}:${bucket}` },
      );
    });
  },
});

/**
 * Library → fees: student library fines become a `LIBRARY` fee charge (head auto-created),
 * idempotent per fine. Returning null (finance off for the institution) keeps the fine PENDING
 * at the library desk.
 */
registerLibraryFinePoster(async (fine) => {
  const enabled = await isFeatureEnabled(currentFeatureContext(), 'finance', {
    institutionId: fine.institutionId,
  });
  if (!enabled) return null;
  const invoice = await createStudentCharge({
    studentId: fine.studentId,
    feeHeadCode: 'LIBRARY',
    amount: fine.amount,
    dueDate: today(),
    sourceType: 'LIBRARY_FINE',
    sourceId: fine.fineId,
    description: fine.description.slice(0, 500),
  });
  return { externalChargeId: invoice.id };
});

/**
 * Transport / hostel → fees: monthly student transport & hostel charges become `TRANSPORT` /
 * `HOSTEL` fee charges (heads auto-created), idempotent per source charge; due on the 1st of the
 * period (or today when later). Returning null (finance off) keeps the charge PENDING; waiving a
 * POSTED charge cancels its unpaid invoice. Staff charges stay module-local.
 */
const CHARGE_SOURCE = { transport: 'TRANSPORT_CHARGE', hostel: 'HOSTEL_CHARGE' } as const;
registerStudentChargePoster(
  async (charge) => {
    if (!charge.studentId) return null;
    const enabled = await isFeatureEnabled(currentFeatureContext(), 'finance', {
      institutionId: charge.institutionId,
    });
    if (!enabled) return null;
    const periodStart = `${charge.period}-01`;
    const now = today();
    const invoice = await createStudentCharge({
      studentId: charge.studentId,
      feeHeadCode: charge.source.toUpperCase(),
      amount: charge.amount,
      dueDate: periodStart > now ? periodStart : now,
      sourceType: CHARGE_SOURCE[charge.source],
      sourceId: charge.sourceChargeId,
      description: charge.description.slice(0, 500),
    });
    return invoice.id;
  },
  async (charge) => {
    await cancelStudentCharge({
      studentId: charge.studentId,
      sourceType: CHARGE_SOURCE[charge.source],
      sourceId: charge.sourceChargeId,
      reason: charge.reason,
    });
  },
);

/**
 * Fees → students: outstanding dues (open invoices due on or before the leaving date) checked
 * before a transfer certificate is issued. Null when finance is off for the institution.
 */
registerStudentDuesProvider(async ({ studentId, institutionId, asOf }) => {
  const enabled = await isFeatureEnabled(currentFeatureContext(), 'finance', { institutionId });
  if (!enabled) return null;
  const open = await tenantDb().feeInvoice.findMany({
    where: {
      studentId,
      status: { in: ['UNPAID', 'PARTIAL'] },
      dueDate: { lte: new Date(`${asOf}T00:00:00.000Z`) },
    },
    select: { netAmount: true, paidAmount: true },
  });
  const paise = open.reduce((sum, i) => sum + toPaise(i.netAmount) - toPaise(i.paidAmount), 0);
  return { amount: fromPaise(Math.max(0, paise)), invoiceCount: open.length };
});

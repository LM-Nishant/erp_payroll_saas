import type {
  DefaulterDto,
  FinanceTableDto,
  SendRemindersInput,
  StudentFeeSummaryDto,
} from '@erp/shared';
import type { FeeInvoice, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import { andScope, authorize, currentPrincipal, scopeWhere } from '../../core/authz';
import { currentFeatureContext, isFeatureEnabled } from '../../core/features';
import { NotFoundError } from '../../core/http/errors';
import { publish } from '../../core/notifications';
import { tenantDb } from '../../core/tenancy';
import {
  accountFor,
  ensureChartOfAccounts,
  institutionScope,
  postVoucher,
} from '../finance/finance.ledger';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { dateStr, num, toDate, today } from '../finance/finance.mappers';
import { loadFeeStudent } from './fees.access';
import { agingBucket, daysOverdue, invoiceStatus, lateFee } from './fees.logic';
import { toInvoiceDto, toPaymentDto } from './fees.mappers';
import { feeRecipients } from './fees.payments.service';
import { activeUpiSetting, feeUpiService } from './fees.upi.service';

const p = () => currentPrincipal();
const OPEN = { in: ['UNPAID', 'PARTIAL'] };
const balanceOf = (i: Pick<FeeInvoice, 'netAmount' | 'paidAmount'>) =>
  fromPaise(Math.max(0, toPaise(i.netAmount) - toPaise(i.paidAmount)));

interface DueFilter {
  institutionId?: string;
  classSectionId?: string;
  asOf?: string;
  minDays?: number;
}

/** Overdue balances grouped per student (scoped by fee.view unless running as system). */
async function computeDefaulters(f: DueFilter, perm = 'fee.view'): Promise<DefaulterDto[]> {
  const asOf = toDate(f.asOf ?? today());
  const minDays = f.minDays ?? 1;
  const cutoff = new Date(asOf.getTime() - minDays * 86_400_000);
  const where: Prisma.FeeInvoiceWhereInput = {
    status: OPEN,
    dueDate: { lte: cutoff },
    ...(f.institutionId ? { institutionId: f.institutionId } : {}),
    ...(f.classSectionId ? { classSectionId: f.classSectionId } : {}),
  };
  const db = tenantDb();
  const invoices = await db.feeInvoice.findMany({
    where: andScope(where, await scopeWhere(p(), perm, 'finance')),
    select: {
      studentId: true,
      classSectionId: true,
      dueDate: true,
      netAmount: true,
      paidAmount: true,
    },
  });
  const byStudent = new Map<
    string,
    { classSectionId: string | null; count: number; balance: number; oldest: Date }
  >();
  for (const inv of invoices) {
    const bal = toPaise(balanceOf(inv));
    if (bal <= 0) continue;
    const row = byStudent.get(inv.studentId) ?? {
      classSectionId: inv.classSectionId,
      count: 0,
      balance: 0,
      oldest: inv.dueDate,
    };
    row.count += 1;
    row.balance += bal;
    if (inv.dueDate < row.oldest) row.oldest = inv.dueDate;
    byStudent.set(inv.studentId, row);
  }
  const [students, sections] = await Promise.all([
    db.student.findMany({
      where: { id: { in: [...byStudent.keys()] } },
      select: { id: true, displayName: true, admissionNo: true },
    }),
    db.classSection.findMany({
      where: {
        id: {
          in: [...new Set([...byStudent.values()].map((v) => v.classSectionId))].filter(
            (v): v is string => !!v,
          ),
        },
      },
      select: { id: true, name: true },
    }),
  ]);
  const sMap = new Map(students.map((s) => [s.id, s]));
  const cMap = new Map(sections.map((c) => [c.id, c.name]));
  return [...byStudent.entries()]
    .map(([studentId, v]) => {
      const days = daysOverdue(v.oldest, asOf);
      return {
        studentId,
        displayName: sMap.get(studentId)?.displayName ?? '—',
        admissionNo: sMap.get(studentId)?.admissionNo ?? '',
        classSectionId: v.classSectionId,
        classSectionName: v.classSectionId ? (cMap.get(v.classSectionId) ?? null) : null,
        invoiceCount: v.count,
        balance: fromPaise(v.balance),
        oldestDueDate: dateStr(v.oldest),
        daysOverdue: days,
        bucket: agingBucket(days),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
}

/** Applies late fees to overdue invoices with a late-fee rule (idempotent: tops up to the rule). */
export async function applyLateFees(f: { institutionId?: string; asOf?: string } = {}) {
  const asOf = toDate(f.asOf ?? today());
  const db = tenantDb();
  const invoices = await db.feeInvoice.findMany({
    where: {
      status: OPEN,
      lateRuleId: { not: null },
      dueDate: { lt: asOf },
      ...(f.institutionId ? { institutionId: f.institutionId } : {}),
    },
  });
  if (invoices.length === 0) return { updated: 0, amount: 0 };
  const rules = new Map(
    (
      await db.feeLateRule.findMany({
        where: {
          id: { in: [...new Set(invoices.map((i) => i.lateRuleId as string))] },
          active: true,
        },
      })
    ).map((r) => [r.id, r]),
  );
  const keys = await ensureChartOfAccounts();
  let updated = 0;
  let total = 0;
  for (const inv of invoices) {
    const rule = rules.get(inv.lateRuleId as string);
    if (!rule) continue;
    const due = lateFee(
      {
        mode: rule.mode,
        amount: num(rule.amount),
        graceDays: rule.graceDays,
        maxAmount: rule.maxAmount === null ? null : num(rule.maxAmount),
      },
      inv.dueDate,
      asOf,
    );
    const delta = toPaise(due) - toPaise(inv.lateFeeAmount);
    if (delta <= 0) continue;
    await db.$transaction(async (tx) => {
      const net = toPaise(inv.netAmount) + delta;
      const row = await tx.feeInvoice.updateMany({
        where: { id: inv.id, lateFeeAmount: inv.lateFeeAmount, status: OPEN },
        data: {
          lateFeeAmount: due,
          netAmount: fromPaise(net),
          status: invoiceStatus(fromPaise(net), num(inv.paidAmount)),
        },
      });
      if (row.count === 0) return;
      await postVoucher(tx, {
        scope: inv,
        voucherDate: asOf,
        narration: `Late fee on invoice ${inv.number} (${rule.name})`,
        sourceType: 'FEE_LATE_FEE',
        sourceId: inv.id,
        sourceKey: `fee_late:${inv.id}:${due.toFixed(2)}`,
        lines: [
          { accountId: accountFor(keys, 'fee_receivable'), debit: fromPaise(delta), credit: 0 },
          { accountId: accountFor(keys, 'late_fee_income'), debit: 0, credit: fromPaise(delta) },
        ],
      });
      updated += 1;
      total += delta;
    });
  }
  if (updated > 0) {
    await audit.record({
      action: 'fee_invoice.late_fees_applied',
      entityType: 'fee_invoice',
      entityId: f.institutionId ?? 'all',
      metadata: { updated, amount: fromPaise(total), asOf: dateStr(asOf) },
    });
  }
  return { updated, amount: fromPaise(total) };
}

const REMINDER_GAP_MS = 6 * 86_400_000;

/** Sends due reminders to guardians + students of overdue invoices (throttled per invoice). */
export async function sendDueReminders(input: SendRemindersInput, opts: { system?: boolean } = {}) {
  const defaulters = await computeDefaulters(input, opts.system ? 'fee.view' : 'fee.manage');
  const db = tenantDb();
  const now = new Date();
  let sent = 0;
  for (const d of defaulters) {
    const invoices = await db.feeInvoice.findMany({
      where: {
        studentId: d.studentId,
        status: OPEN,
        OR: [
          { lastReminderAt: null },
          { lastReminderAt: { lt: new Date(now.getTime() - REMINDER_GAP_MS) } },
        ],
      },
      select: { id: true, institutionId: true },
    });
    if (invoices.length === 0) continue;
    if (
      opts.system &&
      !(await isFeatureEnabled(currentFeatureContext(), 'finance', {
        institutionId: invoices[0]!.institutionId,
      }))
    ) {
      continue;
    }
    const recipients = await feeRecipients(d.studentId);
    if (recipients.length === 0) continue;
    await publish('fee.due_reminder', {
      recipients,
      title: `Fee due: ₹${d.balance.toFixed(2)} for ${d.displayName}`,
      body: `${d.invoiceCount} invoice(s) overdue since ${d.oldestDueDate} (${d.daysOverdue} days). Please pay at the earliest.`,
      link: '/portal/fees',
      data: { studentId: d.studentId, balance: d.balance },
      institutionId: invoices[0]!.institutionId,
    });
    await db.feeInvoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) } },
      data: { lastReminderAt: now },
    });
    sent += 1;
  }
  if (!opts.system) {
    await audit.record({
      action: 'fee.reminders_sent',
      entityType: 'fee_invoice',
      entityId: input.institutionId ?? 'all',
      metadata: { sent, defaulters: defaulters.length, ...input },
    });
  }
  return { sent, defaulters: defaulters.length };
}

async function summaryFor(studentId: string): Promise<StudentFeeSummaryDto> {
  const db = tenantDb();
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { classSection: { select: { id: true, name: true, code: true } } },
  });
  if (!student) throw new NotFoundError('Student');
  const [invoices, payments] = await Promise.all([
    db.feeInvoice.findMany({
      where: { studentId },
      include: { lines: { include: { feeHead: { select: { name: true } } } } },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    }),
    db.feePayment.findMany({
      where: { studentId },
      include: {
        allocations: { include: { invoice: { select: { number: true } } } },
        refunds: true,
      },
      orderBy: [{ paidOn: 'desc' }],
    }),
  ]);
  const ref = {
    id: student.id,
    displayName: student.displayName,
    admissionNo: student.admissionNo,
  };
  const live = invoices.filter((i) => i.status !== 'CANCELLED');
  const now = toDate(today());
  const billed = live.reduce((s, i) => s + toPaise(i.netAmount), 0);
  const paid = live.reduce((s, i) => s + toPaise(i.paidAmount), 0);
  const overdue = live
    .filter((i) => i.dueDate < now)
    .reduce((s, i) => s + toPaise(balanceOf(i)), 0);
  const [upi, upiPayments] = await Promise.all([
    activeUpiSetting(student.institutionId),
    feeUpiService.forStudent(student.id),
  ]);
  return {
    student: { ...ref, classSection: student.classSection },
    totals: {
      billed: fromPaise(billed),
      paid: fromPaise(paid),
      balance: fromPaise(billed - paid),
      overdue: fromPaise(overdue),
    },
    invoices: invoices.map((i) => toInvoiceDto(i, ref)),
    payments: payments.map((pm) => toPaymentDto(pm, ref)),
    upi: upi ? { upiId: upi.upiId, payeeName: upi.payeeName } : null,
    upiPayments,
  };
}

export const feeDuesService = {
  async defaulters(q: DueFilter & { page: number; pageSize: number; search?: string }) {
    let rows = await computeDefaulters(q);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) => r.displayName.toLowerCase().includes(s) || r.admissionNo.toLowerCase().includes(s),
      );
    }
    const start = (q.page - 1) * q.pageSize;
    return { items: rows.slice(start, start + q.pageSize), total: rows.length };
  },

  sendReminders: (input: SendRemindersInput) => sendDueReminders(input),

  async applyLateFees(input: { institutionId?: string }) {
    await authorize(
      p(),
      'fee.manage',
      input.institutionId ? await institutionScope(input.institutionId) : {},
    );
    return applyLateFees(input);
  },

  /** Fee summary for a student (staff with fee.view, the student, or a guardian). */
  async studentSummary(studentId: string) {
    await loadFeeStudent(studentId);
    return summaryFor(studentId);
  },

  async me() {
    const userId = p().userId;
    const student = userId ? await tenantDb().student.findFirst({ where: { userId } }) : null;
    if (!student) throw new NotFoundError('Student');
    return summaryFor(student.id);
  },

  async myWards() {
    const userId = p().userId;
    if (!userId) return [];
    const links = await tenantDb().studentGuardian.findMany({
      where: { guardian: { userId } },
      select: { studentId: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids = [...new Set(links.map((l) => l.studentId))];
    return Promise.all(ids.map((id) => summaryFor(id)));
  },

  async report(
    key: 'collections' | 'dues' | 'aging' | 'head_wise' | 'concessions',
    q: { institutionId?: string; classSectionId?: string; from?: string; to?: string },
  ): Promise<FinanceTableDto> {
    const db = tenantDb();
    const scope = await scopeWhere(p(), 'fee.view', 'finance');
    const base = {
      ...(q.institutionId ? { institutionId: q.institutionId } : {}),
    };
    const range =
      q.from || q.to
        ? {
            ...(q.from ? { gte: toDate(q.from) } : {}),
            ...(q.to ? { lte: toDate(q.to) } : {}),
          }
        : undefined;
    const period = q.from || q.to ? `${q.from ?? '…'} to ${q.to ?? '…'}` : 'All dates';
    const students = async (ids: string[]) =>
      new Map(
        (
          await db.student.findMany({
            where: { id: { in: [...new Set(ids)] } },
            select: { id: true, displayName: true, admissionNo: true },
          })
        ).map((s) => [s.id, s]),
      );
    const sectionNames = async (ids: Array<string | null>) =>
      new Map(
        (
          await db.classSection.findMany({
            where: { id: { in: [...new Set(ids.filter((v): v is string => !!v))] } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name]),
      );

    if (key === 'collections') {
      const rows = await db.feePayment.findMany({
        where: andScope(
          {
            ...base,
            status: { not: 'CANCELLED' },
            ...(range ? { paidOn: range } : {}),
          },
          scope,
        ),
        orderBy: [{ paidOn: 'asc' }, { number: 'asc' }],
      });
      const sMap = await students(rows.map((r) => r.studentId));
      const byMode = new Map<string, number>();
      for (const r of rows) byMode.set(r.mode, (byMode.get(r.mode) ?? 0) + toPaise(r.amount));
      const total = rows.reduce((s, r) => s + toPaise(r.amount), 0);
      const refunded = rows.reduce((s, r) => s + toPaise(r.refundedAmount), 0);
      return {
        title: 'Fee collections',
        subtitle: period,
        columns: [
          'Date',
          'Receipt',
          'Student',
          'Adm. no',
          'Mode',
          'Reference',
          'Amount',
          'Refunded',
        ],
        rows: [
          ...rows.map((r) => [
            dateStr(r.paidOn),
            r.number,
            sMap.get(r.studentId)?.displayName ?? '',
            sMap.get(r.studentId)?.admissionNo ?? '',
            r.mode,
            r.reference ?? '',
            num(r.amount),
            num(r.refundedAmount),
          ]),
          ...[...byMode.entries()].map(([mode, amt]) => [
            '',
            '',
            `Subtotal ${mode}`,
            '',
            mode,
            '',
            fromPaise(amt),
            '',
          ]),
          ['', '', 'Total', '', '', '', fromPaise(total), fromPaise(refunded)],
        ],
      };
    }

    const invoiceWhere: Prisma.FeeInvoiceWhereInput = andScope(
      {
        ...base,
        ...(q.classSectionId ? { classSectionId: q.classSectionId } : {}),
        status: { not: 'CANCELLED' },
        ...(range ? { dueDate: range } : {}),
      },
      scope,
    );

    if (key === 'dues') {
      const rows = await db.feeInvoice.findMany({
        where: invoiceWhere,
        select: { studentId: true, classSectionId: true, netAmount: true, paidAmount: true },
      });
      const agg = new Map<string, { cs: string | null; billed: number; paid: number }>();
      for (const r of rows) {
        const a = agg.get(r.studentId) ?? { cs: r.classSectionId, billed: 0, paid: 0 };
        a.billed += toPaise(r.netAmount);
        a.paid += toPaise(r.paidAmount);
        agg.set(r.studentId, a);
      }
      const [sMap, cMap] = await Promise.all([
        students([...agg.keys()]),
        sectionNames([...agg.values()].map((a) => a.cs)),
      ]);
      const list = [...agg.entries()]
        .filter(([, a]) => a.billed > a.paid)
        .sort((x, y) => y[1].billed - y[1].paid - (x[1].billed - x[1].paid));
      const t = list.reduce(
        (s, [, a]) => ({ billed: s.billed + a.billed, paid: s.paid + a.paid }),
        { billed: 0, paid: 0 },
      );
      return {
        title: 'Fee dues',
        subtitle: period,
        columns: ['Student', 'Adm. no', 'Class', 'Billed', 'Paid', 'Balance'],
        rows: [
          ...list.map(([id, a]) => [
            sMap.get(id)?.displayName ?? '',
            sMap.get(id)?.admissionNo ?? '',
            a.cs ? (cMap.get(a.cs) ?? '') : '',
            fromPaise(a.billed),
            fromPaise(a.paid),
            fromPaise(a.billed - a.paid),
          ]),
          ['Total', '', '', fromPaise(t.billed), fromPaise(t.paid), fromPaise(t.billed - t.paid)],
        ],
      };
    }

    if (key === 'aging') {
      const asOf = toDate(q.to ?? today());
      const rows = await db.feeInvoice.findMany({
        where: andScope(
          {
            ...base,
            ...(q.classSectionId ? { classSectionId: q.classSectionId } : {}),
            status: OPEN,
          },
          scope,
        ),
        select: { classSectionId: true, dueDate: true, netAmount: true, paidAmount: true },
      });
      const buckets = ['Not due', '0-30', '31-60', '61-90', '90+'] as const;
      const agg = new Map<string, number[]>();
      for (const r of rows) {
        const k = r.classSectionId ?? '';
        const arr = agg.get(k) ?? [0, 0, 0, 0, 0];
        const days = daysOverdue(r.dueDate, asOf);
        const idx = r.dueDate >= asOf ? 0 : buckets.indexOf(agingBucket(days));
        arr[idx] = (arr[idx] ?? 0) + toPaise(balanceOf(r));
        agg.set(k, arr);
      }
      const cMap = await sectionNames([...agg.keys()]);
      const totals = [0, 0, 0, 0, 0];
      const out = [...agg.entries()]
        .map(([k, arr]) => {
          arr.forEach((v, i) => (totals[i] = (totals[i] ?? 0) + v));
          return [
            cMap.get(k) ?? (k || '—'),
            ...arr.map(fromPaise),
            fromPaise(arr.reduce((s, v) => s + v, 0)),
          ];
        })
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return {
        title: 'Dues aging',
        subtitle: `As of ${dateStr(asOf)}`,
        columns: ['Class', ...buckets, 'Total'],
        rows: [
          ...out,
          ['Total', ...totals.map(fromPaise), fromPaise(totals.reduce((s, v) => s + v, 0))],
        ],
      };
    }

    if (key === 'head_wise') {
      const lines = await db.feeInvoiceLine.groupBy({
        by: ['feeHeadId'],
        where: { invoice: invoiceWhere },
        _sum: { amount: true, concessionAmount: true, taxAmount: true, netAmount: true },
      });
      const heads = new Map(
        (
          await db.feeHead.findMany({
            where: { id: { in: lines.map((l) => l.feeHeadId) } },
            select: { id: true, name: true, code: true },
          })
        ).map((h) => [h.id, h]),
      );
      const t = [0, 0, 0, 0];
      const rows = lines.map((l) => {
        const vals = [
          l._sum.amount,
          l._sum.concessionAmount,
          l._sum.taxAmount,
          l._sum.netAmount,
        ].map((v) => toPaise(v ?? 0));
        vals.forEach((v, i) => (t[i] = (t[i] ?? 0) + v));
        return [
          heads.get(l.feeHeadId)?.code ?? '',
          heads.get(l.feeHeadId)?.name ?? '',
          ...vals.map(fromPaise),
        ];
      });
      return {
        title: 'Head-wise billing',
        subtitle: period,
        columns: ['Code', 'Fee head', 'Gross', 'Concession', 'Tax', 'Net'],
        rows: [...rows, ['', 'Total', ...t.map(fromPaise)]],
      };
    }

    // concessions
    const rows = await db.feeInvoice.findMany({
      where: { AND: [invoiceWhere, { concessionAmount: { gt: 0 } }] },
      select: { studentId: true, classSectionId: true, concessionAmount: true },
    });
    const agg = new Map<string, { cs: string | null; count: number; amount: number }>();
    for (const r of rows) {
      const a = agg.get(r.studentId) ?? { cs: r.classSectionId, count: 0, amount: 0 };
      a.count += 1;
      a.amount += toPaise(r.concessionAmount);
      agg.set(r.studentId, a);
    }
    const [sMap, cMap] = await Promise.all([
      students([...agg.keys()]),
      sectionNames([...agg.values()].map((a) => a.cs)),
    ]);
    const total = [...agg.values()].reduce((s, a) => s + a.amount, 0);
    return {
      title: 'Concessions granted',
      subtitle: period,
      columns: ['Student', 'Adm. no', 'Class', 'Invoices', 'Concession'],
      rows: [
        ...[...agg.entries()].map(([id, a]) => [
          sMap.get(id)?.displayName ?? '',
          sMap.get(id)?.admissionNo ?? '',
          a.cs ? (cMap.get(a.cs) ?? '') : '',
          a.count,
          fromPaise(a.amount),
        ]),
        ['Total', '', '', rows.length, fromPaise(total)],
      ],
    };
  },
};

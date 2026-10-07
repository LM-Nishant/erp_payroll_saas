import type { FeeHead, FeeInvoice, Prisma, Student } from '@prisma/client';
import type {
  CreateAdhocInvoiceInput,
  FeeCancelInput,
  GenerateInvoicesInput,
  StudentChargeInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, can, currentPrincipal, scopeWhere } from '../../core/authz';
import { emit } from '../../core/events';
import { isUniqueViolation } from '../../core/db/helpers';
import {
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  accountFor,
  ensureChartOfAccounts,
  incomeKeyForCategory,
  nextNumbers,
  postVoucher,
  type Tx,
} from '../finance/finance.ledger';
import { fromPaise, toPaise, type DraftLine } from '../finance/finance.logic';
import { num, toDate, today } from '../finance/finance.mappers';
import { loadFeeStudent, ownStudentIds } from './fees.access';
import {
  computeInvoice,
  siblingRanks,
  type ComputedInvoice,
  type ConcessionRule,
} from './fees.logic';
import { toInvoiceDto, type InvoiceWithRefs } from './fees.mappers';
import { loadStructure } from './fees.setup.service';

const p = () => currentPrincipal();

type HeadInfo = Pick<FeeHead, 'id' | 'category' | 'incomeAccountId' | 'taxRate' | 'name'>;

const studentScope = (s: Student) => ({
  groupId: s.groupId,
  institutionId: s.institutionId,
  campusId: s.campusId,
  departmentId: s.departmentId,
});

/**
 * Demand journal for a set of invoices of ONE student: Dr fee receivable (net) + Dr
 * concessions; Cr income per head (gross) + Cr tax payable.
 */
function demandLines(
  keys: Map<string, string>,
  heads: Map<string, HeadInfo>,
  invoices: ComputedInvoice[],
): DraftLine[] {
  const income = new Map<string, number>();
  let net = 0;
  let concession = 0;
  let tax = 0;
  for (const inv of invoices) {
    net += toPaise(inv.netAmount);
    concession += toPaise(inv.concessionAmount);
    tax += toPaise(inv.taxAmount);
    for (const l of inv.lines) {
      const head = heads.get(l.feeHeadId);
      const account =
        head?.incomeAccountId ??
        keys.get(incomeKeyForCategory(head?.category ?? 'MISC')) ??
        accountFor(keys, 'income_misc');
      income.set(account, (income.get(account) ?? 0) + toPaise(l.amount));
    }
  }
  return [
    { accountId: accountFor(keys, 'fee_receivable'), debit: fromPaise(net), credit: 0 },
    { accountId: accountFor(keys, 'concession_expense'), debit: fromPaise(concession), credit: 0 },
    ...[...income.entries()].map(([accountId, amt]) => ({
      accountId,
      debit: 0,
      credit: fromPaise(amt),
    })),
    { accountId: accountFor(keys, 'tax_payable'), debit: 0, credit: fromPaise(tax) },
  ];
}

const reverse = (lines: DraftLine[]): DraftLine[] =>
  lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

interface NewInvoice {
  computed: ComputedInvoice;
  dueDate: Date;
  structureId?: string | null;
  installmentId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  dedupeKey?: string | null;
  description?: string | null;
  lateRuleId?: string | null;
}

/** Creates invoices (+lines) for one student and posts their demand voucher, inside `tx`. */
async function writeInvoices(
  tx: Tx,
  student: Student,
  issueDate: Date,
  invoices: NewInvoice[],
  heads: Map<string, HeadInfo>,
  keys: Map<string, string>,
  voucherSourceKey: string,
): Promise<FeeInvoice[]> {
  const numbers = await nextNumbers(tx, student.institutionId, 'INVOICE', invoices.length);
  const created: FeeInvoice[] = [];
  for (const [i, inv] of invoices.entries()) {
    const c = inv.computed;
    const row = await tx.feeInvoice.create({
      data: withTenant({
        ...studentScope(student),
        programId: student.programId,
        classSectionId: student.classSectionId,
        studentId: student.id,
        academicYear: student.academicYear,
        number: numbers[i] as string,
        structureId: inv.structureId ?? null,
        installmentId: inv.installmentId ?? null,
        sourceType: inv.sourceType,
        sourceId: inv.sourceId ?? null,
        dedupeKey: inv.dedupeKey ?? null,
        description: inv.description ?? null,
        issueDate,
        dueDate: inv.dueDate,
        grossAmount: c.grossAmount,
        concessionAmount: c.concessionAmount,
        taxAmount: c.taxAmount,
        netAmount: c.netAmount,
        status: c.netAmount > 0 ? 'UNPAID' : 'PAID',
        lateRuleId: inv.lateRuleId ?? null,
        createdByUserId: p().userId ?? null,
      }),
    });
    await tx.feeInvoiceLine.createMany({
      data: c.lines.map((l) =>
        withTenant({
          invoiceId: row.id,
          feeHeadId: l.feeHeadId,
          description: l.description,
          amount: l.amount,
          concessionAmount: l.concessionAmount,
          taxAmount: l.taxAmount,
          netAmount: l.netAmount,
        }),
      ),
    });
    created.push(row);
  }
  const lines = demandLines(
    keys,
    heads,
    invoices.map((i) => i.computed),
  );
  if (lines.some((l) => l.debit > 0)) {
    await postVoucher(tx, {
      scope: studentScope(student),
      voucherDate: issueDate,
      narration: `Fee demand ${created.map((c) => c.number).join(', ')} — ${student.displayName}`,
      sourceType: 'FEE_INVOICE',
      sourceId: created[0]?.id ?? null,
      sourceKey: voucherSourceKey,
      lines,
    });
  }
  return created;
}

/** Active concessions of the institution keyed for quick matching. */
async function concessionsFor(institutionId: string, academicYear: string | null) {
  return tenantDb().feeConcession.findMany({
    where: {
      institutionId,
      active: true,
      OR: [{ academicYear: null }, ...(academicYear ? [{ academicYear }] : [])],
    },
  });
}

async function siblingRankMap(students: Student[]): Promise<Map<string, number>> {
  if (students.length === 0) return new Map();
  const db = tenantDb();
  const ownLinks = await db.studentGuardian.findMany({
    where: { studentId: { in: students.map((s) => s.id) } },
    select: { guardianId: true },
  });
  const guardianIds = [...new Set(ownLinks.map((l) => l.guardianId))];
  if (guardianIds.length === 0) return new Map();
  const links = await db.studentGuardian.findMany({
    where: { guardianId: { in: guardianIds }, student: { status: 'ACTIVE' } },
    select: { studentId: true, guardianId: true },
  });
  const all = await db.student.findMany({
    where: { id: { in: [...new Set(links.map((l) => l.studentId))] } },
    select: { id: true, admissionDate: true, dateOfBirth: true, createdAt: true },
  });
  const order = all
    .sort(
      (a, b) =>
        (a.dateOfBirth?.getTime() ?? a.createdAt.getTime()) -
          (b.dateOfBirth?.getTime() ?? b.createdAt.getTime()) || a.id.localeCompare(b.id),
    )
    .map((s) => s.id);
  return siblingRanks(links, order);
}

function matchConcessions(
  student: Student,
  all: Awaited<ReturnType<typeof concessionsFor>>,
  siblingRank: number,
): ConcessionRule[] {
  return all
    .filter((c) => {
      if (c.appliesTo === 'STUDENT') return c.studentId === student.id;
      if (c.appliesTo === 'CATEGORY') {
        return (
          !!student.category &&
          !!c.category &&
          student.category.toLowerCase() === c.category.toLowerCase()
        );
      }
      if (c.appliesTo === 'SIBLING') return siblingRank >= 2;
      return false;
    })
    .map((c) => ({
      id: c.id,
      feeHeadId: c.feeHeadId,
      valueType: c.valueType,
      value: num(c.value),
    }));
}

async function headMap(ids: string[]): Promise<Map<string, HeadInfo>> {
  const heads = await tenantDb().feeHead.findMany({
    where: { id: { in: ids } },
    select: { id: true, category: true, incomeAccountId: true, taxRate: true, name: true },
  });
  return new Map(heads.map((h) => [h.id, h]));
}

const invoiceInclude = {
  lines: { include: { feeHead: { select: { name: true } } } },
} as const;

async function studentRefs(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0)
    return new Map<string, { id: string; displayName: string; admissionNo: string }>();
  const rows = await tenantDb().student.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true, admissionNo: true },
  });
  return new Map(rows.map((s) => [s.id, s]));
}

export async function loadInvoice(id: string, perm = 'fee.view') {
  const inv = await tenantDb().feeInvoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!inv) throw new NotFoundError('Invoice');
  if (!(await can(p(), perm, inv))) {
    if (perm !== 'fee.view') throw new NotFoundError('Invoice');
    await loadFeeStudent(inv.studentId);
  }
  return inv as InvoiceWithRefs;
}

export const feeInvoiceService = {
  async generate(input: GenerateInvoicesInput) {
    const structure = await loadStructure(input.structureId, 'fee.manage');
    await authorize(p(), 'fee.manage', structure);
    if (structure.status !== 'ACTIVE') {
      throw new ConflictError('Only active fee structures can generate invoices');
    }
    const installments = structure.installments.filter(
      (i) => !input.installmentIds || input.installmentIds.includes(i.id),
    );
    if (installments.length === 0) throw new ValidationError('No installments selected');
    const db = tenantDb();
    const sectionId = input.classSectionId ?? structure.classSectionId;
    if (
      structure.classSectionId &&
      input.classSectionId &&
      input.classSectionId !== structure.classSectionId
    ) {
      throw new ValidationError('classSectionId does not match the structure');
    }
    const where: Prisma.StudentWhereInput = {
      institutionId: structure.institutionId,
      status: 'ACTIVE',
      ...(sectionId ? { classSectionId: sectionId } : {}),
      ...(structure.programId ? { programId: structure.programId } : {}),
      ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
    };
    const students = await db.student.findMany({
      where: andScope(where, await scopeWhere(p(), 'fee.manage', 'student')),
      orderBy: { admissionNo: 'asc' },
    });
    if (input.studentIds && students.length !== new Set(input.studentIds).size) {
      throw new InvalidReferenceError('studentIds', 'Student');
    }
    const heads = await headMap([
      ...new Set(installments.flatMap((i) => i.items.map((it) => it.feeHeadId))),
    ]);
    const concessions = await concessionsFor(structure.institutionId, structure.academicYear);
    const ranks = concessions.some((c) => c.appliesTo === 'SIBLING')
      ? await siblingRankMap(students)
      : new Map<string, number>();
    const existing = new Set(
      (
        await db.feeInvoice.findMany({
          where: {
            installmentId: { in: installments.map((i) => i.id) },
            studentId: { in: students.map((s) => s.id) },
          },
          select: { dedupeKey: true },
        })
      ).map((i) => i.dedupeKey),
    );
    const keys = await ensureChartOfAccounts();
    const issueDate = toDate(input.issueDate ?? today());
    let created = 0;
    let skipped = 0;
    let total = 0;
    for (const student of students) {
      const rules = matchConcessions(student, concessions, ranks.get(student.id) ?? 1);
      const todo: NewInvoice[] = [];
      for (const inst of installments) {
        const dedupeKey = `inst:${inst.id}:${student.id}`;
        if (existing.has(dedupeKey)) {
          skipped += 1;
          continue;
        }
        const computed = computeInvoice(
          inst.items.map((it) => ({
            feeHeadId: it.feeHeadId,
            amount: num(it.amount),
            taxRate: num(heads.get(it.feeHeadId)?.taxRate ?? 0),
            description: null,
          })),
          rules,
        );
        todo.push({
          computed,
          dueDate: inst.dueDate,
          structureId: structure.id,
          installmentId: inst.id,
          sourceType: 'STRUCTURE',
          dedupeKey,
          description: `${structure.name} — ${inst.label}`,
          lateRuleId: structure.lateRuleId,
        });
      }
      if (todo.length === 0) continue;
      try {
        const rows = await db.$transaction((tx) =>
          writeInvoices(
            tx,
            student,
            issueDate,
            todo,
            heads,
            keys,
            `fee_demand:${crypto.randomUUID()}`,
          ),
        );
        created += rows.length;
        total += rows.reduce((s, r) => s + toPaise(r.netAmount), 0);
      } catch (err) {
        if (isUniqueViolation(err)) {
          skipped += todo.length;
          continue;
        }
        throw err;
      }
    }
    await audit.record({
      action: 'fee_invoice.generated',
      entityType: 'fee_structure',
      entityId: structure.id,
      metadata: {
        created,
        skipped,
        students: students.length,
        installments: installments.map((i) => i.id),
        classSectionId: sectionId,
        total: fromPaise(total),
      },
    });
    if (created > 0) {
      await emit(
        'fee.invoices_generated',
        { structureId: structure.id, created, total: fromPaise(total) },
        { institutionId: structure.institutionId },
      );
    }
    return { created, skipped, students: students.length, total: fromPaise(total) };
  },

  async createAdhoc(input: CreateAdhocInvoiceInput) {
    const { student } = await loadFeeStudent(input.studentId, 'fee.manage');
    await authorize(p(), 'fee.manage', studentScope(student));
    const heads = await headMap(input.lines.map((l) => l.feeHeadId));
    for (const l of input.lines) {
      const h = heads.get(l.feeHeadId);
      if (!h) throw new InvalidReferenceError('lines.feeHeadId', 'Fee head');
    }
    const headRows = await tenantDb().feeHead.findMany({
      where: { id: { in: [...heads.keys()] } },
      select: { id: true, institutionId: true },
    });
    if (headRows.some((h) => h.institutionId && h.institutionId !== student.institutionId)) {
      throw new InvalidReferenceError('lines.feeHeadId', 'Fee head');
    }
    const computed = computeInvoice(
      input.lines.map((l) => ({
        feeHeadId: l.feeHeadId,
        amount: l.amount,
        taxRate: num(heads.get(l.feeHeadId)?.taxRate ?? 0),
        description: l.description ?? null,
      })),
      [],
    );
    const keys = await ensureChartOfAccounts();
    const [row] = await tenantDb().$transaction((tx) =>
      writeInvoices(
        tx,
        student,
        toDate(today()),
        [
          {
            computed,
            dueDate: toDate(input.dueDate),
            sourceType: 'ADHOC',
            description: input.description ?? null,
          },
        ],
        heads,
        keys,
        `fee_adhoc:${crypto.randomUUID()}`,
      ),
    );
    const dto = toInvoiceDto(await loadInvoice((row as FeeInvoice).id), student);
    await audit.record({
      action: 'fee_invoice.created',
      entityType: 'fee_invoice',
      entityId: dto.id,
      after: dto,
    });
    await emit(
      'fee.invoice_created',
      { invoiceId: dto.id, studentId: student.id, amount: dto.netAmount, sourceType: 'ADHOC' },
      { institutionId: student.institutionId },
    );
    return dto;
  },

  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    classSectionId?: string;
    studentId?: string;
    status?: string;
    open?: 'true' | 'false';
    academicYear?: string;
    overdue?: 'true' | 'false';
  }) {
    const where: Prisma.FeeInvoiceWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.classSectionId ? { classSectionId: query.classSectionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.academicYear ? { academicYear: query.academicYear } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.open === 'true' ? { status: { in: ['UNPAID', 'PARTIAL'] } } : {}),
      ...(query.overdue === 'true'
        ? { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: toDate(today()) } }
        : {}),
      ...(query.search ? { number: { contains: query.search } } : {}),
    };
    const scoped = andScope(where, await scopeWhere(p(), 'fee.view', 'finance'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feeInvoice.findMany({
        where: scoped,
        orderBy: [{ dueDate: 'desc' }, { number: 'desc' }],
        ...toPageWindow(query),
      }),
      db.feeInvoice.count({ where: scoped }),
    ]);
    const refs = await studentRefs(rows.map((r) => r.studentId));
    return { items: rows.map((r) => toInvoiceDto(r, refs.get(r.studentId))), total };
  },

  async get(id: string) {
    const inv = await loadInvoice(id);
    const refs = await studentRefs([inv.studentId]);
    return toInvoiceDto(inv, refs.get(inv.studentId));
  },

  async cancel(id: string, input: FeeCancelInput) {
    const before = await loadInvoice(id, 'fee.manage');
    await authorize(p(), 'fee.manage', before);
    const dto = await cancelInvoiceInternal(before, input.reason);
    return dto;
  },

  /** Invoices of the current student / parent's wards (portal). */
  async mine() {
    const ids = await ownStudentIds();
    if (ids.length === 0) return [];
    const rows = await tenantDb().feeInvoice.findMany({
      where: { studentId: { in: ids } },
      orderBy: [{ dueDate: 'asc' }],
    });
    const refs = await studentRefs(ids);
    return rows.map((r) => toInvoiceDto(r, refs.get(r.studentId)));
  },
};

async function cancelInvoiceInternal(before: InvoiceWithRefs, reason: string) {
  if (before.status === 'CANCELLED') throw new ConflictError('Invoice is already cancelled');
  if (toPaise(before.paidAmount) > 0) {
    throw new ConflictError('Invoice has payments; cancel or re-allocate the receipts first');
  }
  const lines = before.lines ?? [];
  const heads = await headMap(lines.map((l) => l.feeHeadId));
  const keys = await ensureChartOfAccounts();
  const computed: ComputedInvoice = {
    lines: lines.map((l) => ({
      feeHeadId: l.feeHeadId,
      description: l.description,
      amount: num(l.amount),
      concessionAmount: num(l.concessionAmount),
      taxAmount: num(l.taxAmount),
      netAmount: num(l.netAmount),
    })),
    grossAmount: num(before.grossAmount),
    concessionAmount: num(before.concessionAmount),
    taxAmount: num(before.taxAmount),
    netAmount: num(before.netAmount) - num(before.lateFeeAmount),
    appliedConcessionIds: [],
  };
  const reversal = reverse(demandLines(keys, heads, [computed]));
  const late = toPaise(before.lateFeeAmount);
  if (late > 0) {
    reversal.push(
      { accountId: accountFor(keys, 'late_fee_income'), debit: fromPaise(late), credit: 0 },
      { accountId: accountFor(keys, 'fee_receivable'), debit: 0, credit: fromPaise(late) },
    );
  }
  await tenantDb().$transaction(async (tx) => {
    await tx.feeInvoice.update({
      where: { id: before.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        // Free the natural key so the installment can be re-billed later.
        dedupeKey: before.dedupeKey ? `${before.dedupeKey}:x:${before.id}`.slice(0, 191) : null,
      },
    });
    if (reversal.some((l) => l.debit > 0)) {
      await postVoucher(tx, {
        scope: before,
        voucherDate: toDate(today()),
        narration: `Cancellation of fee invoice ${before.number}: ${reason}`,
        sourceType: 'FEE_INVOICE_CANCEL',
        sourceId: before.id,
        sourceKey: `fee_invoice_cancel:${before.id}`,
        lines: reversal,
      });
    }
  });
  const after = await loadInvoice(before.id, 'fee.view');
  const dto = toInvoiceDto(after);
  await audit.record({
    action: 'fee_invoice.cancelled',
    entityType: 'fee_invoice',
    entityId: before.id,
    before: toInvoiceDto(before),
    after: dto,
    reason,
  });
  await emit(
    'fee.invoice_cancelled',
    { invoiceId: before.id, studentId: before.studentId, reason },
    { institutionId: before.institutionId },
  );
  return dto;
}

const CHARGE_CATEGORIES = new Set([
  'TUITION',
  'TRANSPORT',
  'HOSTEL',
  'LIBRARY',
  'EXAM',
  'ADMISSION',
  'MISC',
]);

/**
 * Generic charge API for other modules (transport, hostel, library fines, exams…): bills a
 * student for `amount` under fee head `feeHeadCode` (institution head first, then org-wide; a
 * head whose code equals a category such as TRANSPORT is auto-created when missing). Idempotent
 * per (sourceType, sourceId, student, head) when sourceId is given. Runs as the CURRENT principal
 * without a permission check — callers authorise their own action. Posts the demand journal.
 */
export async function createStudentCharge(input: StudentChargeInput) {
  const db = tenantDb();
  const student = await db.student.findUnique({ where: { id: input.studentId } });
  if (!student) throw new InvalidReferenceError('studentId', 'Student');
  const code = input.feeHeadCode.toUpperCase();
  let head =
    (await db.feeHead.findFirst({ where: { code, institutionId: student.institutionId } })) ??
    (await db.feeHead.findFirst({ where: { code, institutionId: null } }));
  if (!head && CHARGE_CATEGORIES.has(code)) {
    head = await db.feeHead.create({
      data: withTenant({
        code,
        name: code.charAt(0) + code.slice(1).toLowerCase() + ' fee',
        category: code,
        refundable: false,
      }),
    });
  }
  if (!head) throw new InvalidReferenceError('feeHeadCode', 'Fee head');
  const dedupeKey = input.sourceId
    ? `src:${input.sourceType}:${input.sourceId}:${student.id}:${code}`.slice(0, 191)
    : null;
  if (dedupeKey) {
    const existing = await db.feeInvoice.findFirst({
      where: { dedupeKey },
      include: invoiceInclude,
    });
    if (existing) return toInvoiceDto(existing);
  }
  const heads = new Map<string, HeadInfo>([[head.id, head]]);
  const computed = computeInvoice(
    [
      {
        feeHeadId: head.id,
        amount: input.amount,
        taxRate: num(head.taxRate),
        description: input.description ?? null,
      },
    ],
    [],
  );
  const keys = await ensureChartOfAccounts();
  let row: FeeInvoice;
  try {
    [row] = (await db.$transaction((tx) =>
      writeInvoices(
        tx,
        student,
        toDate(today()),
        [
          {
            computed,
            dueDate: toDate(input.dueDate),
            sourceType: input.sourceType,
            sourceId: input.sourceId ?? null,
            dedupeKey,
            description: input.description ?? head.name,
          },
        ],
        heads,
        keys,
        dedupeKey ? `fee_charge:${dedupeKey}`.slice(0, 191) : `fee_charge:${crypto.randomUUID()}`,
      ),
    )) as [FeeInvoice];
  } catch (err) {
    if (dedupeKey && isUniqueViolation(err)) {
      const existing = await db.feeInvoice.findFirst({
        where: { dedupeKey },
        include: invoiceInclude,
      });
      if (existing) return toInvoiceDto(existing);
    }
    throw err;
  }
  const dto = toInvoiceDto(
    await db.feeInvoice.findUniqueOrThrow({ where: { id: row.id }, include: invoiceInclude }),
  );
  await audit.record({
    action: 'fee_invoice.charged',
    entityType: 'fee_invoice',
    entityId: dto.id,
    after: dto,
    metadata: { sourceType: input.sourceType, sourceId: input.sourceId ?? null },
  });
  await emit(
    'fee.invoice_created',
    {
      invoiceId: dto.id,
      studentId: student.id,
      amount: dto.netAmount,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
    },
    { institutionId: student.institutionId },
  );
  return dto;
}

/** Cancels an unpaid charge created via createStudentCharge (no-op when none / already cancelled). */
export async function cancelStudentCharge(input: {
  studentId: string;
  sourceType: string;
  sourceId: string;
  reason: string;
}) {
  const rows = await tenantDb().feeInvoice.findMany({
    where: {
      studentId: input.studentId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: { not: 'CANCELLED' },
    },
    include: invoiceInclude,
  });
  const out = [];
  for (const r of rows) out.push(await cancelInvoiceInternal(r as InvoiceWithRefs, input.reason));
  return out;
}

export { studentRefs };

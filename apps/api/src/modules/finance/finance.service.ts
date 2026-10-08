import type { Prisma } from '@prisma/client';
import type {
  CreateAccountInput,
  CreateExpenseInput,
  CreateVendorInput,
  CreateVoucherInput,
  FeeCancelInput,
  FinanceReportKey,
  FinanceTableDto,
  UpdateAccountInput,
  UpdateVendorInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, can, currentPrincipal, scopeWhere } from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { emit } from '../../core/events';
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
  cancelVoucherInTx,
  ensureChartOfAccounts,
  institutionScope,
  moneyAccountKey,
  nextNumbers,
  postVoucher,
  type Db,
  type Tx,
} from './finance.ledger';
import {
  assertBalanced,
  fromPaise,
  incomeExpenditure,
  runningBalance,
  toPaise,
  trialBalance,
  UnbalancedVoucherError,
  type BalanceRow,
} from './finance.logic';
import {
  dateStr,
  num,
  toAccountDto,
  toDate,
  toExpenseDto,
  toVendorDto,
  toVoucherDto,
} from './finance.mappers';

const p = () => currentPrincipal();

async function visibleWhere(perm: string) {
  return scopeWhere(p(), perm, 'finance');
}

/** Rows with an optional institutionId (vendors): org-wide rows are visible to every holder. */
async function optionalInstitutionScope(perm: string) {
  const scope = await visibleWhere(perm);
  return scope ? { OR: [scope, { institutionId: null }] } : undefined;
}

async function resolveAccount(id: string, field: string, db: Db | Tx = tenantDb()) {
  const acc = await db.ledgerAccount.findUnique({ where: { id } });
  if (!acc) throw new InvalidReferenceError(field, 'Ledger account');
  if (acc.isGroup) throw new ValidationError(`Account ${acc.code} is a group account`);
  if (!acc.active) throw new ValidationError(`Account ${acc.code} is inactive`);
  return acc;
}

function asValidation(err: unknown): never {
  if (err instanceof UnbalancedVoucherError) throw new ValidationError(err.message);
  throw err;
}

/* ------------------------------------ Accounts ----------------------------------------- */

export const accountService = {
  async list(query: { includeInactive?: boolean } = {}) {
    await ensureChartOfAccounts();
    const rows = await tenantDb().ledgerAccount.findMany({
      where: query.includeInactive ? {} : { active: true },
      orderBy: { code: 'asc' },
    });
    return rows.map(toAccountDto);
  },

  async create(input: CreateAccountInput) {
    await authorize(p(), 'finance.manage', {});
    await ensureChartOfAccounts();
    if (input.parentId) {
      const parent = await tenantDb().ledgerAccount.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new InvalidReferenceError('parentId', 'Ledger account');
      if (!parent.isGroup) throw new ValidationError('Parent account must be a group account');
      if (parent.type !== input.type) {
        throw new ValidationError('Account type must match the parent account type');
      }
    }
    try {
      const created = await tenantDb().ledgerAccount.create({
        data: withTenant({
          parentId: input.parentId ?? null,
          code: input.code,
          name: input.name,
          type: input.type,
          isGroup: input.isGroup,
          description: input.description ?? null,
          active: input.active,
        }),
      });
      await audit.record({
        action: 'ledger_account.created',
        entityType: 'ledger_account',
        entityId: created.id,
        after: toAccountDto(created),
      });
      return toAccountDto(created);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('An account with this code exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateAccountInput) {
    await authorize(p(), 'finance.manage', {});
    const before = await tenantDb().ledgerAccount.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Ledger account');
    if (before.systemKey && input.active === false) {
      throw new ConflictError('System accounts cannot be deactivated');
    }
    const updated = await tenantDb().ledgerAccount.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await audit.record({
      action: 'ledger_account.updated',
      entityType: 'ledger_account',
      entityId: id,
      before: toAccountDto(before),
      after: toAccountDto(updated),
    });
    return toAccountDto(updated);
  },

  async remove(id: string) {
    await authorize(p(), 'finance.manage', {});
    const db = tenantDb();
    const before = await db.ledgerAccount.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Ledger account');
    if (before.systemKey) throw new ConflictError('System accounts cannot be deleted');
    const [children, lines] = await Promise.all([
      db.ledgerAccount.count({ where: { parentId: id } }),
      db.journalLine.count({ where: { accountId: id } }),
    ]);
    if (children > 0 || lines > 0) {
      throw new ConflictError('Account has sub-accounts or postings; deactivate it instead');
    }
    await db.ledgerAccount.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'ledger_account.deleted',
      entityType: 'ledger_account',
      entityId: id,
      before: toAccountDto(before),
    });
  },
};

/* ------------------------------------ Vouchers ----------------------------------------- */

const voucherInclude = {
  lines: { include: { account: { select: { code: true, name: true } } } },
} as const;

async function loadVoucher(id: string, perm: string) {
  const v = await tenantDb().journalVoucher.findUnique({ where: { id }, include: voucherInclude });
  if (!v || !(await can(p(), perm, v))) throw new NotFoundError('Voucher');
  return v;
}

export const voucherService = {
  async list(query: {
    page: number;
    pageSize: number;
    institutionId?: string;
    status?: string;
    type?: string;
    sourceType?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.JournalVoucherWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.from || query.to
        ? {
            voucherDate: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const scoped = andScope(where, await visibleWhere('finance.view'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.journalVoucher.findMany({
        where: scoped,
        orderBy: [{ voucherDate: 'desc' }, { number: 'desc' }],
        ...toPageWindow(query),
      }),
      db.journalVoucher.count({ where: scoped }),
    ]);
    return { items: rows.map((v) => toVoucherDto(v)), total };
  },

  async get(id: string) {
    return toVoucherDto(await loadVoucher(id, 'finance.view'));
  },

  async create(input: CreateVoucherInput) {
    const scope = await institutionScope(input.institutionId);
    await authorize(p(), 'finance.manage', scope);
    if (input.post) await authorize(p(), 'finance.post', scope);
    await ensureChartOfAccounts();
    for (const [i, l] of input.lines.entries()) {
      await resolveAccount(l.accountId, `lines.${i}.accountId`);
    }
    try {
      assertBalanced(input.lines);
    } catch (err) {
      asValidation(err);
    }
    const voucher = await tenantDb().$transaction((tx) =>
      postVoucher(tx, {
        scope,
        voucherDate: toDate(input.voucherDate),
        type: input.type,
        narration: input.narration ?? '',
        sourceType: 'MANUAL',
        lines: input.lines,
        status: input.post ? 'POSTED' : 'DRAFT',
      }),
    );
    const full = await loadVoucher(voucher.id, 'finance.view');
    await audit.record({
      action: 'journal_voucher.created',
      entityType: 'journal_voucher',
      entityId: voucher.id,
      after: toVoucherDto(full),
    });
    if (voucher.status === 'POSTED') {
      await emit(
        'finance.voucher_posted',
        { voucherId: voucher.id, number: voucher.number, amount: num(voucher.totalAmount) },
        { institutionId: voucher.institutionId },
      );
    }
    return toVoucherDto(full);
  },

  async post(id: string) {
    const before = await loadVoucher(id, 'finance.view');
    await authorize(p(), 'finance.post', before);
    if (before.status !== 'DRAFT') throw new ConflictError('Only draft vouchers can be posted');
    await tenantDb().journalVoucher.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), postedByUserId: p().userId ?? null },
    });
    const after = await loadVoucher(id, 'finance.view');
    await audit.record({
      action: 'journal_voucher.posted',
      entityType: 'journal_voucher',
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });
    await emit(
      'finance.voucher_posted',
      { voucherId: id, number: after.number, amount: num(after.totalAmount) },
      { institutionId: after.institutionId },
    );
    return toVoucherDto(after);
  },

  async cancel(id: string, input: FeeCancelInput) {
    const before = await loadVoucher(id, 'finance.view');
    await authorize(p(), 'finance.post', before);
    if (before.status === 'CANCELLED') throw new ConflictError('Voucher is already cancelled');
    if (before.sourceType !== 'MANUAL') {
      throw new ConflictError(
        'System-posted vouchers are cancelled by cancelling the source document',
      );
    }
    await tenantDb().$transaction((tx) => cancelVoucherInTx(tx, id, input.reason));
    await audit.record({
      action: 'journal_voucher.cancelled',
      entityType: 'journal_voucher',
      entityId: id,
      reason: input.reason,
      before: { status: before.status },
      after: { status: 'CANCELLED' },
    });
    return toVoucherDto(await loadVoucher(id, 'finance.view'));
  },
};

/* ------------------------------------ Vendors ------------------------------------------ */

export const vendorService = {
  async list(query: { page: number; pageSize: number; search?: string; institutionId?: string }) {
    const where: Prisma.VendorWhereInput = {
      ...(query.institutionId
        ? { OR: [{ institutionId: query.institutionId }, { institutionId: null }] }
        : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
        : {}),
    };
    const scoped = andScope(where, await optionalInstitutionScope('finance.view'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.vendor.findMany({ where: scoped, orderBy: { name: 'asc' }, ...toPageWindow(query) }),
      db.vendor.count({ where: scoped }),
    ]);
    return { items: rows.map(toVendorDto), total };
  },

  async create(input: CreateVendorInput) {
    const scope = input.institutionId ? await institutionScope(input.institutionId) : null;
    await authorize(p(), 'finance.manage', scope ?? {});
    try {
      const created = await tenantDb().vendor.create({
        data: withTenant({
          groupId: scope?.groupId ?? null,
          institutionId: scope?.institutionId ?? null,
          code: input.code,
          name: input.name,
          gstin: input.gstin ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          active: input.active,
        }),
      });
      await audit.record({
        action: 'vendor.created',
        entityType: 'vendor',
        entityId: created.id,
        after: toVendorDto(created),
      });
      return toVendorDto(created);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A vendor with this code exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateVendorInput) {
    const before = await tenantDb().vendor.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Vendor');
    await authorize(p(), 'finance.manage', before.institutionId ? before : {});
    const updated = await tenantDb().vendor.update({ where: { id }, data: input });
    await audit.record({
      action: 'vendor.updated',
      entityType: 'vendor',
      entityId: id,
      before: toVendorDto(before),
      after: toVendorDto(updated),
    });
    return toVendorDto(updated);
  },
};

/* ------------------------------------ Expenses ----------------------------------------- */

export const expenseService = {
  async list(query: {
    page: number;
    pageSize: number;
    institutionId?: string;
    vendorId?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.ExpenseWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.from || query.to
        ? {
            expenseDate: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const scoped = andScope(where, await visibleWhere('finance.view'));
    const db = tenantDb();
    const [rows, total, accounts] = await Promise.all([
      db.expense.findMany({
        where: scoped,
        include: { vendor: { select: { name: true } } },
        orderBy: [{ expenseDate: 'desc' }, { number: 'desc' }],
        ...toPageWindow(query),
      }),
      db.expense.count({ where: scoped }),
      db.ledgerAccount.findMany({ select: { id: true, name: true } }),
    ]);
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    return { items: rows.map((e) => toExpenseDto(e, names)), total };
  },

  async create(input: CreateExpenseInput) {
    const scope = await institutionScope(input.institutionId);
    await authorize(p(), 'finance.manage', scope);
    const keys = await ensureChartOfAccounts();
    const expenseAccount = await resolveAccount(input.expenseAccountId, 'expenseAccountId');
    if (expenseAccount.type !== 'EXPENSE') {
      throw new ValidationError('expenseAccountId must be an expense account');
    }
    const paymentAccountId =
      input.paymentAccountId ?? accountFor(keys, moneyAccountKey(input.mode));
    const paymentAccount = await resolveAccount(paymentAccountId, 'paymentAccountId');
    if (paymentAccount.type !== 'ASSET' && paymentAccount.type !== 'LIABILITY') {
      throw new ValidationError('paymentAccountId must be a cash / bank or creditor account');
    }
    if (input.vendorId) {
      const vendor = await tenantDb().vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor) throw new InvalidReferenceError('vendorId', 'Vendor');
    }
    const expense = await tenantDb().$transaction(async (tx) => {
      const [number] = await nextNumbers(tx, scope.institutionId, 'EXPENSE');
      const created = await tx.expense.create({
        data: withTenant({
          groupId: scope.groupId,
          institutionId: scope.institutionId,
          number: number as string,
          expenseDate: toDate(input.expenseDate),
          vendorId: input.vendorId ?? null,
          expenseAccountId: expenseAccount.id,
          paymentAccountId: paymentAccount.id,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference ?? null,
          description: input.description,
          createdByUserId: p().userId ?? null,
        }),
      });
      const voucher = await postVoucher(tx, {
        scope,
        voucherDate: created.expenseDate,
        type: 'PAYMENT',
        narration: `Expense ${created.number}: ${input.description}`,
        sourceType: 'EXPENSE',
        sourceId: created.id,
        sourceKey: `expense:${created.id}`,
        lines: [
          { accountId: expenseAccount.id, debit: input.amount, credit: 0 },
          { accountId: paymentAccount.id, debit: 0, credit: input.amount },
        ],
      });
      return tx.expense.update({
        where: { id: created.id },
        data: { voucherId: voucher.id },
        include: { vendor: { select: { name: true } } },
      });
    });
    const dto = toExpenseDto(expense, new Map([[expenseAccount.id, expenseAccount.name]]));
    await audit.record({
      action: 'expense.created',
      entityType: 'expense',
      entityId: expense.id,
      after: dto,
    });
    await emit(
      'finance.expense_recorded',
      { expenseId: expense.id, number: expense.number, amount: input.amount },
      { institutionId: expense.institutionId },
    );
    return dto;
  },

  async cancel(id: string, input: FeeCancelInput) {
    const before = await tenantDb().expense.findUnique({ where: { id } });
    if (!before || !(await can(p(), 'finance.view', before))) throw new NotFoundError('Expense');
    await authorize(p(), 'finance.manage', before);
    if (before.status === 'CANCELLED') throw new ConflictError('Expense is already cancelled');
    await tenantDb().$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason },
      });
      await cancelVoucherInTx(tx, before.voucherId, `Expense cancelled: ${input.reason}`);
    });
    await audit.record({
      action: 'expense.cancelled',
      entityType: 'expense',
      entityId: id,
      reason: input.reason,
      before: { status: before.status },
      after: { status: 'CANCELLED' },
    });
    return { id, status: 'CANCELLED' };
  },
};

/* ------------------------------------ Reports ------------------------------------------ */

interface ReportQuery {
  institutionId?: string;
  accountId?: string;
  from?: string;
  to?: string;
}

async function postedVoucherWhere(q: ReportQuery, range: { from?: string; to?: string }) {
  const where: Prisma.JournalVoucherWhereInput = {
    status: 'POSTED',
    ...(q.institutionId ? { institutionId: q.institutionId } : {}),
    ...(range.from || range.to
      ? {
          voucherDate: {
            ...(range.from ? { gte: toDate(range.from) } : {}),
            ...(range.to ? { lte: toDate(range.to) } : {}),
          },
        }
      : {}),
  };
  return andScope(where, await visibleWhere('finance.view'));
}

async function balances(q: ReportQuery, range: { from?: string; to?: string }) {
  const db = tenantDb();
  const voucher = await postedVoucherWhere(q, range);
  const [sums, accounts] = await Promise.all([
    db.journalLine.groupBy({
      by: ['accountId'],
      where: { voucher },
      _sum: { debit: true, credit: true },
    }),
    db.ledgerAccount.findMany({ where: { isGroup: false } }),
  ]);
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map<BalanceRow>((a) => ({
    accountId: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    debit: num(byId.get(a.id)?.debit),
    credit: num(byId.get(a.id)?.credit),
  }));
}

const dayBefore = (s: string) => dateStr(new Date(toDate(s).getTime() - 86_400_000));
const subtitle = (q: ReportQuery) =>
  `${q.from ? `From ${q.from}` : 'From beginning'}${q.to ? ` to ${q.to}` : ''}`;

export const financeReportService = {
  async build(key: FinanceReportKey, q: ReportQuery): Promise<FinanceTableDto> {
    await ensureChartOfAccounts();
    if (key === 'trial_balance') {
      const tb = trialBalance(await balances(q, { to: q.to }));
      return {
        title: 'Trial balance',
        subtitle: q.to ? `As of ${q.to}` : 'As of today',
        columns: ['Code', 'Account', 'Type', 'Debit', 'Credit'],
        rows: [
          ...tb.rows.map((r) => [r.code, r.name, r.type, r.closingDebit, r.closingCredit]),
          ['', 'Total', '', tb.totalDebit, tb.totalCredit],
        ],
      };
    }
    if (key === 'income_expenditure') {
      const ie = incomeExpenditure(await balances(q, q));
      return {
        title: 'Income & expenditure',
        subtitle: subtitle(q),
        columns: ['Section', 'Code', 'Account', 'Amount'],
        rows: [
          ...ie.income.map((r) => ['Income', r.code, r.name, r.amount]),
          ['Income', '', 'Total income', ie.totalIncome],
          ...ie.expense.map((r) => ['Expenditure', r.code, r.name, r.amount]),
          ['Expenditure', '', 'Total expenditure', ie.totalExpense],
          [
            ie.surplus >= 0 ? 'Surplus' : 'Deficit',
            '',
            'Excess of income over expenditure',
            ie.surplus,
          ],
        ],
      };
    }
    const db = tenantDb();
    if (key === 'ledger') {
      if (!q.accountId) throw new ValidationError('accountId is required for the ledger');
      const account = await db.ledgerAccount.findUnique({ where: { id: q.accountId } });
      if (!account) throw new InvalidReferenceError('accountId', 'Ledger account');
      let opening = 0;
      if (q.from) {
        const prior = await db.journalLine.aggregate({
          where: {
            accountId: account.id,
            voucher: await postedVoucherWhere(q, { to: dayBefore(q.from) }),
          },
          _sum: { debit: true, credit: true },
        });
        opening = runningBalance(account.type, 0, [
          { debit: num(prior._sum.debit), credit: num(prior._sum.credit) },
        ])[0] as number;
      }
      const lines = await db.journalLine.findMany({
        where: { accountId: account.id, voucher: await postedVoucherWhere(q, q) },
        include: { voucher: true },
        orderBy: [{ voucher: { voucherDate: 'asc' } }, { voucher: { number: 'asc' } }],
        take: 5000,
      });
      const entries = lines.map((l) => ({ debit: num(l.debit), credit: num(l.credit) }));
      const running = runningBalance(account.type, opening, entries);
      return {
        title: `Ledger — ${account.code} ${account.name}`,
        subtitle: subtitle(q),
        columns: ['Date', 'Voucher', 'Narration', 'Debit', 'Credit', 'Balance'],
        rows: [
          ['', '', 'Opening balance', 0, 0, opening],
          ...lines.map((l, i) => [
            dateStr(l.voucher.voucherDate),
            l.voucher.number,
            l.narration ?? l.voucher.narration ?? '',
            num(l.debit),
            num(l.credit),
            running[i] as number,
          ]),
          [
            '',
            '',
            'Closing balance',
            fromPaise(entries.reduce((s, e) => s + toPaise(e.debit), 0)),
            fromPaise(entries.reduce((s, e) => s + toPaise(e.credit), 0)),
            running.at(-1) ?? opening,
          ],
        ],
      };
    }
    // day_book
    const from = q.from ?? q.to ?? dateStr(new Date());
    const to = q.to ?? from;
    const vouchers = await db.journalVoucher.findMany({
      where: await postedVoucherWhere(q, { from, to }),
      include: voucherInclude,
      orderBy: [{ voucherDate: 'asc' }, { number: 'asc' }],
      take: 2000,
    });
    const rows: Array<Array<string | number>> = [];
    for (const v of vouchers) {
      for (const l of [...v.lines].sort((a, b) => a.lineNo - b.lineNo)) {
        rows.push([
          dateStr(v.voucherDate),
          v.number,
          v.type,
          `${l.account.code} ${l.account.name}`,
          v.narration ?? '',
          num(l.debit),
          num(l.credit),
        ]);
      }
    }
    const dr = fromPaise(vouchers.reduce((s, v) => s + toPaise(num(v.totalAmount)), 0));
    rows.push(['', '', '', 'Total', '', dr, dr]);
    return {
      title: 'Day book',
      subtitle: from === to ? from : `${from} to ${to}`,
      columns: ['Date', 'Voucher', 'Type', 'Account', 'Narration', 'Debit', 'Credit'],
      rows,
    };
  },
};

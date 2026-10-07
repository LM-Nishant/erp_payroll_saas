import { fromPaise, toPaise } from '../finance/finance.logic';

/*
 * Pure fee math (no I/O). Amounts in / out are rupees; internal arithmetic is in paise.
 */

export interface ChargeItem {
  feeHeadId: string;
  amount: number;
  taxRate: number;
  description?: string | null;
}

export interface ConcessionRule {
  id: string;
  feeHeadId: string | null;
  valueType: 'PERCENT' | 'AMOUNT' | string;
  value: number;
}

export interface ComputedLine {
  feeHeadId: string;
  description: string | null;
  amount: number;
  concessionAmount: number;
  taxAmount: number;
  netAmount: number;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  grossAmount: number;
  concessionAmount: number;
  taxAmount: number;
  netAmount: number;
  appliedConcessionIds: string[];
}

/**
 * Applies concessions to the charge lines. PERCENT concessions reduce each matching line by the
 * percentage; AMOUNT concessions are spread over the matching lines in order. A line's total
 * concession never exceeds its amount. Tax (GST) is charged on the post-concession amount.
 */
export function computeInvoice(
  items: ChargeItem[],
  concessions: ConcessionRule[],
): ComputedInvoice {
  const lines = items.map((i) => ({
    feeHeadId: i.feeHeadId,
    description: i.description ?? null,
    amount: toPaise(i.amount),
    concession: 0,
    taxRate: i.taxRate,
  }));
  const applied = new Set<string>();
  const matches = (c: ConcessionRule, l: { feeHeadId: string }) =>
    !c.feeHeadId || c.feeHeadId === l.feeHeadId;
  for (const c of concessions.filter((c) => c.valueType === 'PERCENT')) {
    for (const l of lines.filter((l) => matches(c, l))) {
      const cut = Math.min(l.amount - l.concession, Math.round((l.amount * c.value) / 100));
      if (cut > 0) {
        l.concession += cut;
        applied.add(c.id);
      }
    }
  }
  for (const c of concessions.filter((c) => c.valueType === 'AMOUNT')) {
    let left = toPaise(c.value);
    for (const l of lines.filter((l) => matches(c, l))) {
      const cut = Math.min(left, l.amount - l.concession);
      if (cut > 0) {
        l.concession += cut;
        left -= cut;
        applied.add(c.id);
      }
      if (left <= 0) break;
    }
  }
  const out = lines.map((l) => {
    const taxable = l.amount - l.concession;
    const tax = Math.round((taxable * l.taxRate) / 100);
    return {
      feeHeadId: l.feeHeadId,
      description: l.description,
      amount: fromPaise(l.amount),
      concessionAmount: fromPaise(l.concession),
      taxAmount: fromPaise(tax),
      netAmount: fromPaise(taxable + tax),
    };
  });
  const sum = (k: keyof Omit<ComputedLine, 'feeHeadId' | 'description'>) =>
    fromPaise(out.reduce((s, l) => s + toPaise(l[k]), 0));
  return {
    lines: out,
    grossAmount: sum('amount'),
    concessionAmount: sum('concessionAmount'),
    taxAmount: sum('taxAmount'),
    netAmount: sum('netAmount'),
    appliedConcessionIds: [...applied],
  };
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/** Whole days `asOf` is past `dueDate` (0 when not yet due). */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  return Math.max(0, utcDay(asOf) - utcDay(dueDate));
}

export interface LateRule {
  mode: 'FLAT' | 'PER_DAY' | string;
  amount: number;
  graceDays: number;
  maxAmount: number | null;
}

/** Late fee due on an invoice as of `asOf`: nothing within the grace period, then flat/per-day. */
export function lateFee(rule: LateRule, dueDate: Date, asOf: Date): number {
  const late = daysOverdue(dueDate, asOf) - rule.graceDays;
  if (late <= 0) return 0;
  let fee = rule.mode === 'PER_DAY' ? toPaise(rule.amount) * late : toPaise(rule.amount);
  if (rule.maxAmount !== null && rule.maxAmount !== undefined) {
    fee = Math.min(fee, toPaise(rule.maxAmount));
  }
  return fromPaise(fee);
}

export interface OpenInvoice {
  id: string;
  dueDate: Date;
  balance: number;
}

/** Allocates `amount` to open invoices, oldest due date first. Returns allocations + advance. */
export function allocateOldestFirst(
  invoices: OpenInvoice[],
  amount: number,
): { allocations: Array<{ invoiceId: string; amount: number }>; unallocated: number } {
  let left = toPaise(amount);
  const allocations: Array<{ invoiceId: string; amount: number }> = [];
  const sorted = [...invoices].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id),
  );
  for (const inv of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, toPaise(inv.balance));
    if (take <= 0) continue;
    allocations.push({ invoiceId: inv.id, amount: fromPaise(take) });
    left -= take;
  }
  return { allocations, unallocated: fromPaise(left) };
}

export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export function invoiceStatus(net: number, paid: number): Exclude<InvoiceStatus, 'CANCELLED'> {
  const n = toPaise(net);
  const p = toPaise(paid);
  if (p <= 0) return n <= 0 ? 'PAID' : 'UNPAID';
  return p >= n ? 'PAID' : 'PARTIAL';
}

export function agingBucket(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * Sibling rank of each student (1 = eldest / first admitted). Students sharing at least one
 * guardian are siblings; `order` lists student ids by admission precedence.
 */
export function siblingRanks(
  links: Array<{ studentId: string; guardianId: string }>,
  order: string[],
): Map<string, number> {
  const guardiansOf = new Map<string, Set<string>>();
  const studentsOf = new Map<string, Set<string>>();
  const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  for (const l of links) {
    addTo(guardiansOf, l.studentId, l.guardianId);
    addTo(studentsOf, l.guardianId, l.studentId);
  }
  const position = new Map(order.map((id, i) => [id, i]));
  const ranks = new Map<string, number>();
  for (const id of order) {
    const siblings = new Set<string>();
    for (const g of guardiansOf.get(id) ?? []) {
      for (const s of studentsOf.get(g) ?? []) if (s !== id) siblings.add(s);
    }
    const mine = position.get(id) ?? Number.MAX_SAFE_INTEGER;
    let before = 0;
    for (const s of siblings) {
      if ((position.get(s) ?? Number.MAX_SAFE_INTEGER) < mine) before += 1;
    }
    ranks.set(id, before + 1);
  }
  return ranks;
}

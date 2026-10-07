import type { LibraryMemberType } from '@erp/shared';

/*
 * Pure library rules (no I/O) — unit tested in library.logic.test.ts.
 * Dates are calendar dates `YYYY-MM-DD` (UTC), matching `@db.Date` columns.
 */

const DAY_MS = 86_400_000;

export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);
export const toDate = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
export const addDays = (date: string, n: number): string =>
  dateStr(new Date(toDate(date).getTime() + n * DAY_MS));
export const daysBetween = (from: string, to: string): number =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface PolicyValues {
  maxBooks: number;
  loanDays: number;
  maxRenewals: number;
  finePerDay: number;
  maxFine: number;
  holdDays: number;
}

/** Defaults used until the library configures a policy for the institution / member type. */
export const DEFAULT_POLICIES: Record<LibraryMemberType, PolicyValues> = {
  STUDENT: { maxBooks: 3, loanDays: 14, maxRenewals: 1, finePerDay: 2, maxFine: 200, holdDays: 3 },
  EMPLOYEE: { maxBooks: 6, loanDays: 30, maxRenewals: 2, finePerDay: 1, maxFine: 100, holdDays: 3 },
};

/** Whole days a loan is past due on `asOf` (0 when not overdue). */
export function overdueDays(dueDate: string, asOf: string): number {
  return Math.max(0, daysBetween(dueDate, asOf));
}

/** Overdue fine: days late × fine/day, capped at `maxFine` (a cap ≤ 0 means uncapped). */
export function computeOverdueFine(
  dueDate: string,
  asOf: string,
  policy: Pick<PolicyValues, 'finePerDay' | 'maxFine'>,
): number {
  const raw = overdueDays(dueDate, asOf) * policy.finePerDay;
  return round2(policy.maxFine > 0 ? Math.min(raw, policy.maxFine) : raw);
}

/** Due date for an issue or renewal starting on `from`. */
export function dueDateFor(from: string, policy: Pick<PolicyValues, 'loanDays'>): string {
  return addDays(from, policy.loanDays);
}

/**
 * Overdue reminder cadence: first reminder the day after the due date, then every
 * `everyDays` days, at most `maxReminders` times.
 */
export function shouldSendOverdueReminder(
  input: { dueDate: string; lastReminderAt: string | null; reminderCount: number },
  today: string,
  everyDays = 3,
  maxReminders = 5,
): boolean {
  if (overdueDays(input.dueDate, today) < 1) return false;
  if (input.reminderCount >= maxReminders) return false;
  if (!input.lastReminderAt) return true;
  return daysBetween(input.lastReminderAt.slice(0, 10), today) >= everyDays;
}

/** `PREFIX-000123` style accession number. */
export function formatAccessionNo(prefix: string, n: number, padding = 6): string {
  return `${prefix}-${String(n).padStart(padding, '0')}`;
}

/** Split an authors / tags cell like "A. Author; B. Author" or "a, b" into a clean list. */
export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[;|,]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Normalise an import header (`Publication Year` → `publicationyear`). */
export const normHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export const IMPORT_HEADER_MAP: Record<string, string> = {
  isbn: 'isbn',
  issn: 'isbn',
  title: 'title',
  subtitle: 'subtitle',
  author: 'authors',
  authors: 'authors',
  publisher: 'publisher',
  edition: 'edition',
  year: 'publicationYear',
  publicationyear: 'publicationYear',
  category: 'category',
  subject: 'category',
  language: 'language',
  tags: 'tags',
  callnumber: 'callNumber',
  callno: 'callNumber',
  type: 'itemType',
  itemtype: 'itemType',
  url: 'url',
  link: 'url',
  description: 'description',
  copies: 'copies',
  shelf: 'shelf',
  rack: 'rack',
};

/** Map raw header → value rows (from CSV or XLSX) to canonical import field names. */
export function mapImportRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = IMPORT_HEADER_MAP[normHeader(k)];
    if (!field || v === undefined || v === null || String(v).trim() === '') continue;
    out[field] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

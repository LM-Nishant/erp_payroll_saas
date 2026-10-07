import type {
  LibraryBook,
  LibraryCopy,
  LibraryFine,
  LibraryLoan,
  LibraryReservation,
} from '@prisma/client';
import type {
  LibraryBookDto,
  LibraryCopyDto,
  LibraryFineDto,
  LibraryLoanDto,
  LibraryReservationDto,
  LibraryCopyStatus,
  LibraryFineReason,
  LibraryFineStatus,
  LibraryItemType,
  LibraryLoanStatus,
  LibraryMemberType,
  LibraryReservationStatus,
} from '@erp/shared';
import { computeOverdueFine, dateStr, overdueDays, type PolicyValues } from './library.logic';

export const num = (v: { toString(): string } | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v.toString());
const numOrNull = (v: { toString(): string } | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v.toString());
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function toBookDto(
  b: LibraryBook & { institution?: { id: string; name: string; code: string } | null },
  counts?: { total: number; available: number },
): LibraryBookDto {
  return {
    id: b.id,
    groupId: b.groupId,
    institutionId: b.institutionId,
    campusId: b.campusId,
    itemType: b.itemType as LibraryItemType,
    isbn: b.isbn,
    title: b.title,
    subtitle: b.subtitle,
    authors: list(b.authors),
    publisher: b.publisher,
    edition: b.edition,
    publicationYear: b.publicationYear,
    category: b.category,
    language: b.language,
    tags: list(b.tags),
    callNumber: b.callNumber,
    url: b.url,
    description: b.description,
    coverDocumentId: b.coverDocumentId,
    ...(counts ? { totalCopies: counts.total, availableCopies: counts.available } : {}),
    ...(b.institution !== undefined ? { institution: b.institution } : {}),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toCopyDto(
  c: LibraryCopy & {
    book?: { id: string; title: string; isbn: string | null; callNumber: string | null } | null;
  },
): LibraryCopyDto {
  return {
    id: c.id,
    institutionId: c.institutionId,
    campusId: c.campusId,
    bookId: c.bookId,
    accessionNo: c.accessionNo,
    barcode: c.barcode,
    shelf: c.shelf,
    rack: c.rack,
    status: c.status as LibraryCopyStatus,
    condition: c.condition,
    price: numOrNull(c.price),
    acquiredOn: c.acquiredOn ? dateStr(c.acquiredOn) : null,
    notes: c.notes,
    ...(c.book !== undefined ? { book: c.book } : {}),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export type LoanWithRefs = LibraryLoan & {
  book?: { id: string; title: string; authors: unknown } | null;
  copy?: { id: string; barcode: string; accessionNo: string } | null;
};

export function toLoanDto(
  l: LoanWithRefs,
  today: string,
  policy?: Pick<PolicyValues, 'finePerDay' | 'maxFine'>,
): LibraryLoanDto {
  const due = dateStr(l.dueDate);
  const open = l.status === 'ISSUED';
  const late = open ? overdueDays(due, today) : 0;
  const returnedLate = !open && l.returnedAt ? overdueDays(due, dateStr(l.returnedAt)) : 0;
  return {
    id: l.id,
    institutionId: l.institutionId,
    copyId: l.copyId,
    bookId: l.bookId,
    memberType: l.memberType as LibraryMemberType,
    studentId: l.studentId,
    employeeId: l.employeeId,
    memberName: l.memberName,
    issuedAt: l.issuedAt.toISOString(),
    dueDate: due,
    returnedAt: l.returnedAt ? l.returnedAt.toISOString() : null,
    renewCount: l.renewCount,
    status: l.status as LibraryLoanStatus,
    overdue: late > 0,
    overdueDays: open ? late : returnedLate,
    fineAmount: open && policy ? computeOverdueFine(due, today, policy) : num(l.fineAmount),
    returnCondition: l.returnCondition,
    ...(l.book !== undefined
      ? {
          book: l.book
            ? { id: l.book.id, title: l.book.title, authors: list(l.book.authors) }
            : null,
        }
      : {}),
    ...(l.copy !== undefined ? { copy: l.copy } : {}),
  };
}

export function toReservationDto(
  r: LibraryReservation & {
    book?: { id: string; title: string } | null;
    copy?: { id: string; barcode: string } | null;
  },
  position: number | null = null,
): LibraryReservationDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    bookId: r.bookId,
    copyId: r.copyId,
    memberType: r.memberType as LibraryMemberType,
    studentId: r.studentId,
    employeeId: r.employeeId,
    memberName: r.memberName,
    status: r.status as LibraryReservationStatus,
    position,
    readyAt: r.readyAt ? r.readyAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    ...(r.book !== undefined ? { book: r.book } : {}),
    ...(r.copy !== undefined ? { copy: r.copy } : {}),
  };
}

export function toFineDto(
  f: LibraryFine & { loan?: { book?: { title: string } | null } | null },
): LibraryFineDto {
  return {
    id: f.id,
    institutionId: f.institutionId,
    loanId: f.loanId,
    memberType: f.memberType as LibraryMemberType,
    studentId: f.studentId,
    employeeId: f.employeeId,
    memberName: f.memberName,
    amount: num(f.amount),
    reason: f.reason as LibraryFineReason,
    status: f.status as LibraryFineStatus,
    note: f.note,
    externalChargeId: f.externalChargeId,
    settledAt: f.settledAt ? f.settledAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
    ...(f.loan !== undefined ? { bookTitle: f.loan?.book?.title ?? null } : {}),
  };
}

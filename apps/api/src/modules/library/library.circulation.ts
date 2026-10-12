import type { Prisma } from '@prisma/client';
import type {
  CreateLibraryReservationInput,
  IssueLibraryCopyInput,
  LibraryFineReason,
  LibraryMemberDto,
  LibraryMemberSummaryDto,
  ListLibraryFinesQuery,
  ListLibraryLoansQuery,
  ListLibraryMembersQuery,
  ListLibraryReservationsQuery,
  MyLibraryDto,
  RenewLibraryLoanInput,
  ReserveOwnInput,
  ReturnLibraryCopyInput,
  SettleLibraryFineInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, currentPrincipal, hasPermission } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { logger } from '../../core/logger';
import { publish } from '../../core/notifications';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import {
  canLib,
  libResource,
  libScope,
  memberWhere,
  policyFor,
  resolveMember,
  type LibraryMember,
  type Tx,
} from './library.access';
import { getLibraryFinePoster, LIBRARY_EVENTS, LIBRARY_NOTIFICATIONS } from './library.constants';
import {
  addDays,
  computeOverdueFine,
  dateStr,
  dueDateFor,
  overdueDays,
  round2,
  shouldSendOverdueReminder,
  toDate,
  type PolicyValues,
} from './library.logic';
import { num, toFineDto, toLoanDto, toReservationDto } from './library.mappers';
import { myMembers } from './library.self';

const db = () => tenantDb();
const today = () => dateStr(new Date());
const loanInclude = {
  book: { select: { id: true, title: true, authors: true } },
  copy: { select: { id: true, barcode: true, accessionNo: true } },
} as const;
const reservationInclude = {
  book: { select: { id: true, title: true } },
  copy: { select: { id: true, barcode: true } },
} as const;
const fineInclude = { loan: { select: { book: { select: { title: true } } } } } as const;

const memberData = (m: LibraryMember) => ({
  memberType: m.memberType,
  studentId: m.studentId,
  employeeId: m.employeeId,
  memberUserId: m.userId,
  memberName: m.name.slice(0, 200),
});

/** Policy cache for a list of loans (institution × member type). */
async function policyLookup() {
  const cache = new Map<string, PolicyValues>();
  return async (institutionId: string, memberType: string) => {
    const key = `${institutionId}:${memberType}`;
    if (!cache.has(key))
      cache.set(key, await policyFor(institutionId, memberType as 'STUDENT' | 'EMPLOYEE'));
    return cache.get(key)!;
  };
}

async function loanDtos(rows: Prisma.LibraryLoanGetPayload<{ include: typeof loanInclude }>[]) {
  const policy = await policyLookup();
  const t = today();
  const out = [];
  for (const l of rows) out.push(toLoanDto(l, t, await policy(l.institutionId, l.memberType)));
  return out;
}

/** Users to notify about a member: the member's own user plus (students) linked guardians. */
async function recipientsFor(m: { studentId: string | null; memberUserId: string | null }) {
  const users = new Set<string>();
  if (m.memberUserId) users.add(m.memberUserId);
  if (m.studentId) {
    const links = await db().studentGuardian.findMany({
      where: { studentId: m.studentId },
      include: { guardian: { select: { userId: true } } },
    });
    for (const l of links) if (l.guardian.userId) users.add(l.guardian.userId);
  }
  return [...users];
}

async function notify(
  key: string,
  member: { studentId: string | null; memberUserId: string | null },
  input: { title: string; body: string; institutionId: string; data?: Record<string, unknown> },
) {
  const recipients = await recipientsFor(member);
  if (!recipients.length) return;
  try {
    await publish(key, { recipients, link: '/portal/library', ...input });
  } catch (err) {
    logger.warn({ err, key }, 'library notification failed');
  }
}

/**
 * Hand a returned / released copy to the next WAITING reservation for its book (FIFO). The copy
 * becomes RESERVED and the reservation READY until `holdDays` pass.
 */
async function allocateNextReservation(
  tx: Tx,
  copy: { id: string; bookId: string; institutionId: string },
) {
  const next = await tx.libraryReservation.findFirst({
    where: { bookId: copy.bookId, status: 'WAITING' },
    orderBy: { createdAt: 'asc' },
  });
  if (!next) return null;
  const policy = await policyFor(copy.institutionId, next.memberType as 'STUDENT', tx);
  const now = new Date();
  await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED' } });
  return tx.libraryReservation.update({
    where: { id: next.id },
    data: {
      status: 'READY',
      copyId: copy.id,
      readyAt: now,
      expiresAt: new Date(now.getTime() + policy.holdDays * 86_400_000),
    },
    include: reservationInclude,
  });
}

async function announceReady(r: {
  id: string;
  bookId: string;
  institutionId: string;
  studentId: string | null;
  memberUserId: string | null;
  book?: { title: string } | null;
  expiresAt: Date | null;
}) {
  await emit(
    LIBRARY_EVENTS.reservationReady,
    { reservationId: r.id, bookId: r.bookId },
    { institutionId: r.institutionId },
  );
  await notify(LIBRARY_NOTIFICATIONS.reservationReady, r, {
    title: `Reserved book ready: ${r.book?.title ?? 'library book'}`,
    body: `Your reserved book is ready for pickup${
      r.expiresAt ? ` until ${dateStr(r.expiresAt)}` : ''
    }.`,
    institutionId: r.institutionId,
    data: { reservationId: r.id },
  });
}

/** Create a fine and (students) hand it to the fee module's poster when one is registered. */
async function assessFine(
  loan: {
    id: string;
    groupId: string | null;
    institutionId: string;
    campusId: string | null;
    memberType: string;
    studentId: string | null;
    employeeId: string | null;
    memberUserId: string | null;
    memberName: string;
  },
  amount: number,
  reason: LibraryFineReason,
  description: string,
) {
  if (amount <= 0) return null;
  let fine = await db().libraryFine.create({
    data: withTenant({
      groupId: loan.groupId,
      institutionId: loan.institutionId,
      campusId: loan.campusId,
      loanId: loan.id,
      memberType: loan.memberType,
      studentId: loan.studentId,
      employeeId: loan.employeeId,
      memberUserId: loan.memberUserId,
      memberName: loan.memberName,
      amount: round2(amount),
      reason,
      status: 'PENDING',
    }),
    include: fineInclude,
  });
  const poster = getLibraryFinePoster();
  if (poster && fine.studentId) {
    try {
      const posted = await poster({
        fineId: fine.id,
        organizationId: currentOrganizationId(),
        groupId: fine.groupId,
        institutionId: fine.institutionId,
        studentId: fine.studentId,
        amount: num(fine.amount),
        reason,
        description,
      });
      if (posted)
        fine = await db().libraryFine.update({
          where: { id: fine.id },
          data: { status: 'POSTED', externalChargeId: posted.externalChargeId },
          include: fineInclude,
        });
    } catch (err) {
      logger.warn({ err, fineId: fine.id }, 'posting library fine to fees failed; kept PENDING');
    }
  }
  await audit.record({
    action: 'library_fine.assessed',
    entityType: 'library_fine',
    entityId: fine.id,
    after: { amount: num(fine.amount), reason, status: fine.status, loanId: loan.id },
  });
  await emit(
    LIBRARY_EVENTS.fineAssessed,
    { fineId: fine.id, amount: num(fine.amount), reason },
    { institutionId: fine.institutionId },
  );
  await notify(LIBRARY_NOTIFICATIONS.fineAssessed, fine, {
    title: `Library fine: ₹${num(fine.amount).toFixed(2)}`,
    body: description,
    institutionId: fine.institutionId,
    data: { fineId: fine.id },
  });
  return fine;
}

async function findLoanForReturn(input: ReturnLibraryCopyInput) {
  if (input.loanId) return db().libraryLoan.findUnique({ where: { id: input.loanId } });
  const copy = await db().libraryCopy.findFirst({ where: { barcode: input.barcode } });
  if (!copy) return null;
  return db().libraryLoan.findFirst({ where: { copyId: copy.id, status: 'ISSUED' } });
}

async function reserveFor(member: LibraryMember, bookId: string) {
  const book = await db().libraryBook.findUnique({ where: { id: bookId } });
  if (!book) throw new NotFoundError('Library book');
  if (book.institutionId !== member.institutionId)
    throw new AppError(422, 'NOT_A_MEMBER', 'The member does not belong to this library');
  const [openRes, openLoan] = await Promise.all([
    db().libraryReservation.count({
      where: { bookId, ...memberWhere(member), status: { in: ['WAITING', 'READY'] } },
    }),
    db().libraryLoan.count({ where: { bookId, ...memberWhere(member), status: 'ISSUED' } }),
  ]);
  if (openRes) throw new ConflictError('The member already has a reservation for this book');
  if (openLoan) throw new ConflictError('The member already has this book on loan');
  const reservation = await db().$transaction(async (tx) => {
    const created = await tx.libraryReservation.create({
      data: withTenant({
        groupId: book.groupId,
        institutionId: book.institutionId,
        campusId: book.campusId,
        bookId,
        ...memberData(member),
        status: 'WAITING',
      }),
    });
    // A copy on the shelf is held right away (only when nobody else is waiting before us).
    const ahead = await tx.libraryReservation.count({
      where: { bookId, status: 'WAITING', createdAt: { lt: created.createdAt } },
    });
    const free = ahead
      ? null
      : await tx.libraryCopy.findFirst({
          where: { bookId, status: 'AVAILABLE' },
          orderBy: { accessionNo: 'asc' },
        });
    if (free) return (await allocateNextReservation(tx, free)) ?? created;
    return created;
  });
  await audit.record({
    action: 'library_reservation.created',
    entityType: 'library_reservation',
    entityId: reservation.id,
    after: { bookId, memberName: member.name, status: reservation.status },
  });
  await emit(
    LIBRARY_EVENTS.reserved,
    { reservationId: reservation.id, bookId },
    { institutionId: book.institutionId },
  );
  const full = await db().libraryReservation.findUniqueOrThrow({
    where: { id: reservation.id },
    include: reservationInclude,
  });
  if (full.status === 'READY') await announceReady(full);
  return toReservationDto(full, await queuePosition(full));
}

async function queuePosition(r: { id: string; bookId: string; status: string; createdAt: Date }) {
  if (r.status !== 'WAITING') return null;
  return (
    (await db().libraryReservation.count({
      where: { bookId: r.bookId, status: 'WAITING', createdAt: { lt: r.createdAt } },
    })) + 1
  );
}

async function cancelReservation(id: string, reason: 'CANCELLED' | 'EXPIRED') {
  const before = await db().libraryReservation.findUniqueOrThrow({ where: { id } });
  if (before.status !== 'WAITING' && before.status !== 'READY')
    throw new ConflictError('Reservation is not open');
  const next = await db().$transaction(async (tx) => {
    await tx.libraryReservation.update({
      where: { id },
      data: { status: reason, closedAt: new Date() },
    });
    if (before.status === 'READY' && before.copyId) {
      await tx.libraryCopy.updateMany({
        where: { id: before.copyId, status: 'RESERVED' },
        data: { status: 'AVAILABLE' },
      });
      const copy = await tx.libraryCopy.findUniqueOrThrow({ where: { id: before.copyId } });
      if (copy.status === 'AVAILABLE') return allocateNextReservation(tx, copy);
    }
    return null;
  });
  await audit.record({
    action: reason === 'EXPIRED' ? 'library_reservation.expired' : 'library_reservation.cancelled',
    entityType: 'library_reservation',
    entityId: id,
    before: { status: before.status },
    after: { status: reason },
  });
  if (next) await announceReady(next);
}

async function memberSummary(m: LibraryMember): Promise<LibraryMemberSummaryDto> {
  const where = memberWhere(m);
  const [active, history, fines, reservations, policy] = await Promise.all([
    db().libraryLoan.findMany({
      where: { ...where, status: 'ISSUED' },
      include: loanInclude,
      orderBy: { dueDate: 'asc' },
    }),
    db().libraryLoan.findMany({
      where: { ...where, status: { not: 'ISSUED' } },
      include: loanInclude,
      orderBy: { returnedAt: 'desc' },
      take: 50,
    }),
    db().libraryFine.findMany({ where, include: fineInclude, orderBy: { createdAt: 'desc' } }),
    db().libraryReservation.findMany({
      where: { ...where, status: { in: ['WAITING', 'READY'] } },
      include: reservationInclude,
      orderBy: { createdAt: 'asc' },
    }),
    policyFor(m.institutionId, m.memberType),
  ]);
  const t = today();
  const res = [];
  for (const r of reservations) res.push(toReservationDto(r, await queuePosition(r)));
  return {
    memberType: m.memberType,
    studentId: m.studentId,
    employeeId: m.employeeId,
    name: m.name,
    institutionId: m.institutionId,
    policy: { ...policy, institutionId: m.institutionId, memberType: m.memberType },
    active: active.map((l) => toLoanDto(l, t, policy)),
    history: history.map((l) => toLoanDto(l, t)),
    fines: fines.map(toFineDto),
    reservations: res,
  };
}

export const circulationService = {
  async issue(input: IssueLibraryCopyInput) {
    const principal = currentPrincipal();
    const copy = await db().libraryCopy.findFirst({
      where: input.copyId ? { id: input.copyId } : { barcode: input.barcode },
    });
    if (!copy || !(await canLib('library.view', copy))) throw new NotFoundError('Library copy');
    await authorize(principal, 'library.circulate', libResource(copy));
    if (input.issuedAt) await authorize(principal, 'library.manage', libResource(copy));
    const member = await resolveMember(input, copy.institutionId).catch((err: unknown) => {
      if (err instanceof AppError && err.status === 422)
        throw new AppError(422, 'NOT_A_MEMBER', 'Member not found in this library’s institution');
      throw err;
    });
    const policy = await policyFor(copy.institutionId, member.memberType);
    const issuedAt = input.issuedAt ? toDate(input.issuedAt) : new Date();
    const dueDate = input.dueDate ?? dueDateFor(dateStr(issuedAt), policy);
    if (dueDate < dateStr(issuedAt))
      throw new AppError(422, 'INVALID_DUE_DATE', 'Due date is before the issue date');

    const loan = await db().$transaction(async (tx) => {
      const active = await tx.libraryLoan.count({
        where: { ...memberWhere(member), status: 'ISSUED' },
      });
      if (active >= policy.maxBooks)
        throw new AppError(422, 'LOAN_LIMIT', `Member already has ${active} book(s) issued`, {
          maxBooks: policy.maxBooks,
        });
      const reservation = await tx.libraryReservation.findFirst({
        where: {
          bookId: copy.bookId,
          ...memberWhere(member),
          status: { in: ['WAITING', 'READY'] },
        },
      });
      if (copy.status === 'RESERVED') {
        if (!reservation || reservation.copyId !== copy.id)
          throw new AppError(409, 'COPY_RESERVED', 'This copy is held for another member');
      } else if (copy.status !== 'AVAILABLE') {
        throw new AppError(409, 'COPY_NOT_AVAILABLE', `Copy is ${copy.status.toLowerCase()}`);
      }
      const claimed = await tx.libraryCopy.updateMany({
        where: { id: copy.id, status: copy.status },
        data: { status: 'ISSUED' },
      });
      if (!claimed.count)
        throw new AppError(409, 'COPY_NOT_AVAILABLE', 'Copy was just issued elsewhere');
      const created = await tx.libraryLoan.create({
        data: withTenant({
          groupId: copy.groupId,
          institutionId: copy.institutionId,
          campusId: copy.campusId,
          copyId: copy.id,
          bookId: copy.bookId,
          ...memberData(member),
          issuedAt,
          dueDate: toDate(dueDate),
          status: 'ISSUED',
          issuedByUserId: principal.userId ?? null,
        }),
        include: loanInclude,
      });
      if (reservation) {
        await tx.libraryReservation.update({
          where: { id: reservation.id },
          data: { status: 'FULFILLED', closedAt: new Date(), loanId: created.id },
        });
        // A different copy was held for this member: release it to the queue.
        if (reservation.copyId && reservation.copyId !== copy.id) {
          await tx.libraryCopy.update({
            where: { id: reservation.copyId },
            data: { status: 'AVAILABLE' },
          });
          await allocateNextReservation(tx, {
            id: reservation.copyId,
            bookId: copy.bookId,
            institutionId: copy.institutionId,
          });
        }
      }
      return created;
    });
    await audit.record({
      action: 'library_loan.issued',
      entityType: 'library_loan',
      entityId: loan.id,
      after: { barcode: copy.barcode, memberName: member.name, dueDate },
    });
    await emit(
      LIBRARY_EVENTS.issued,
      { loanId: loan.id, copyId: copy.id, bookId: copy.bookId, dueDate },
      { institutionId: copy.institutionId },
    );
    return toLoanDto(loan, today(), policy);
  },

  async return(input: ReturnLibraryCopyInput) {
    const principal = currentPrincipal();
    const found = await findLoanForReturn(input);
    if (!found || !(await canLib('library.view', found)))
      throw new NotFoundError('Open loan for this copy');
    await authorize(principal, 'library.circulate', libResource(found));
    if (input.returnedAt) await authorize(principal, 'library.manage', libResource(found));
    if (found.status !== 'ISSUED') throw new ConflictError('Loan is already closed');
    const copy = await db().libraryCopy.findUniqueOrThrow({ where: { id: found.copyId } });
    const policy = await policyFor(found.institutionId, found.memberType as 'STUDENT');
    const returnedAt = input.returnedAt ? toDate(input.returnedAt) : new Date();
    const due = dateStr(found.dueDate);
    const lateFine = computeOverdueFine(due, dateStr(returnedAt), policy);
    const lost = input.condition === 'LOST';
    const damaged = input.condition === 'DAMAGED';

    const { loan, reservation } = await db().$transaction(async (tx) => {
      const closed = await tx.libraryLoan.updateMany({
        where: { id: found.id, status: 'ISSUED' },
        data: {
          status: lost ? 'LOST' : 'RETURNED',
          returnedAt,
          returnCondition: input.condition,
          fineAmount: round2(
            lateFine +
              (lost ? (input.damageCharge ?? num(copy.price)) : 0) +
              (damaged ? (input.damageCharge ?? 0) : 0),
          ),
          returnedByUserId: principal.userId ?? null,
        },
      });
      if (!closed.count) throw new ConflictError('Loan is already closed');
      const status = lost ? 'LOST' : damaged ? 'DAMAGED' : 'AVAILABLE';
      await tx.libraryCopy.update({
        where: { id: copy.id },
        data: { status, ...(damaged ? { condition: 'Damaged' } : {}) },
      });
      const r = status === 'AVAILABLE' ? await allocateNextReservation(tx, copy) : null;
      return {
        loan: await tx.libraryLoan.findUniqueOrThrow({
          where: { id: found.id },
          include: loanInclude,
        }),
        reservation: r,
      };
    });
    await audit.record({
      action: 'library_loan.returned',
      entityType: 'library_loan',
      entityId: loan.id,
      before: { status: 'ISSUED', dueDate: due },
      after: { status: loan.status, condition: input.condition, fineAmount: num(loan.fineAmount) },
    });
    await emit(
      LIBRARY_EVENTS.returned,
      { loanId: loan.id, copyId: copy.id, condition: input.condition },
      { institutionId: loan.institutionId },
    );
    const title = loan.book?.title ?? 'library book';
    let fine = null;
    const late = overdueDays(due, dateStr(returnedAt));
    if (lateFine > 0)
      fine = await assessFine(
        found,
        lateFine,
        'OVERDUE',
        `“${title}” returned ${late} day(s) late`,
      );
    if (lost) {
      const amount = input.damageCharge ?? num(copy.price);
      const f = await assessFine(found, amount, 'LOST', `“${title}” reported lost`);
      fine = fine ?? f;
    } else if (damaged && input.damageCharge) {
      const f = await assessFine(found, input.damageCharge, 'DAMAGED', `“${title}” damaged`);
      fine = fine ?? f;
    }
    if (reservation) await announceReady(reservation);
    return {
      loan: toLoanDto(loan, today()),
      fine: fine ? toFineDto(fine) : null,
      reservation: reservation ? toReservationDto(reservation) : null,
    };
  },

  async renew(id: string, input: RenewLibraryLoanInput, self = false) {
    const loan = await db().libraryLoan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundError('Library loan');
    if (!self) {
      if (!(await canLib('library.view', loan))) throw new NotFoundError('Library loan');
      await authorize(currentPrincipal(), 'library.circulate', libResource(loan));
    }
    if (loan.status !== 'ISSUED') throw new ConflictError('Loan is not open');
    const policy = await policyFor(loan.institutionId, loan.memberType as 'STUDENT');
    const t = today();
    if (loan.renewCount >= policy.maxRenewals)
      throw new AppError(422, 'RENEWAL_LIMIT', 'No renewals left for this loan', {
        maxRenewals: policy.maxRenewals,
      });
    if (overdueDays(dateStr(loan.dueDate), t) > 0)
      throw new AppError(422, 'LOAN_OVERDUE', 'Overdue loans must be returned (fine applies)');
    const waiting = await db().libraryReservation.count({
      where: { bookId: loan.bookId, status: 'WAITING' },
    });
    if (waiting)
      throw new AppError(422, 'BOOK_RESERVED', 'Other members are waiting for this book');
    const dueDate = (!self && input.dueDate) || addDays(t, policy.loanDays);
    const updated = await db().libraryLoan.update({
      where: { id },
      data: { dueDate: toDate(dueDate), renewCount: { increment: 1 }, reminderCount: 0 },
      include: loanInclude,
    });
    await audit.record({
      action: 'library_loan.renewed',
      entityType: 'library_loan',
      entityId: id,
      before: { dueDate: dateStr(loan.dueDate), renewCount: loan.renewCount },
      after: { dueDate, renewCount: updated.renewCount },
    });
    await emit(
      LIBRARY_EVENTS.renewed,
      { loanId: id, dueDate },
      { institutionId: loan.institutionId },
    );
    return toLoanDto(updated, t, policy);
  },

  async listLoans(query: ListLibraryLoansQuery) {
    const { skip, take } = toPageWindow(query);
    const t = toDate(today());
    const where = andScope<Prisma.LibraryLoanWhereInput>(
      {
        institutionId: query.institutionId,
        status: query.overdue ? 'ISSUED' : query.status,
        studentId: query.studentId,
        employeeId: query.employeeId,
        bookId: query.bookId,
        ...(query.overdue ? { dueDate: { lt: t } } : {}),
        ...(query.search
          ? {
              OR: [
                { memberName: { contains: query.search } },
                { copy: { barcode: { contains: query.search } } },
                { book: { title: { contains: query.search } } },
              ],
            }
          : {}),
      },
      await libScope(),
    );
    const [rows, total] = await Promise.all([
      db().libraryLoan.findMany({
        where,
        skip,
        take,
        include: loanInclude,
        orderBy: query.overdue
          ? [{ dueDate: 'asc' }, { id: 'asc' }]
          : [{ issuedAt: 'desc' }, { id: 'desc' }],
      }),
      db().libraryLoan.count({ where }),
    ]);
    return { items: await loanDtos(rows), total };
  },

  /* ------------------------------ Reservations ----------------------------------------- */

  async listReservations(query: ListLibraryReservationsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.LibraryReservationWhereInput>(
      {
        institutionId: query.institutionId,
        bookId: query.bookId,
        status: query.status ?? { in: ['WAITING', 'READY'] },
      },
      await libScope(),
    );
    const [rows, total] = await Promise.all([
      db().libraryReservation.findMany({
        where,
        skip,
        take,
        include: reservationInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      db().libraryReservation.count({ where }),
    ]);
    const items = [];
    for (const r of rows) items.push(toReservationDto(r, await queuePosition(r)));
    return { items, total };
  },

  async reserve(input: CreateLibraryReservationInput) {
    const book = await db().libraryBook.findUnique({ where: { id: input.bookId } });
    if (!book || !(await canLib('library.view', book))) throw new NotFoundError('Library book');
    await authorize(currentPrincipal(), 'library.circulate', libResource(book));
    const member = await resolveMember(input, book.institutionId);
    return reserveFor(member, book.id);
  },

  async cancelReservation(id: string) {
    const r = await db().libraryReservation.findUnique({ where: { id } });
    if (!r || !(await canLib('library.view', r))) throw new NotFoundError('Reservation');
    await authorize(currentPrincipal(), 'library.circulate', libResource(r));
    await cancelReservation(id, 'CANCELLED');
  },

  /* ---------------------------------- Fines -------------------------------------------- */

  async listFines(query: ListLibraryFinesQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.LibraryFineWhereInput>(
      {
        institutionId: query.institutionId,
        status: query.status,
        studentId: query.studentId,
        employeeId: query.employeeId,
        ...(query.search ? { memberName: { contains: query.search } } : {}),
      },
      await libScope(),
    );
    const [rows, total, pending] = await Promise.all([
      db().libraryFine.findMany({
        where,
        skip,
        take,
        include: fineInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db().libraryFine.count({ where }),
      db().libraryFine.aggregate({
        where: { ...where, status: 'PENDING' },
        _sum: { amount: true },
      }),
    ]);
    return { items: rows.map(toFineDto), total, pendingAmount: num(pending._sum.amount) };
  },

  async settleFine(id: string, action: 'COLLECTED' | 'WAIVED', input: SettleLibraryFineInput) {
    const fine = await db().libraryFine.findUnique({ where: { id } });
    if (!fine || !(await canLib('library.view', fine))) throw new NotFoundError('Library fine');
    await authorize(currentPrincipal(), 'library.fine', libResource(fine));
    if (fine.status !== 'PENDING')
      throw new ConflictError(
        fine.status === 'POSTED'
          ? 'Fine was posted to the fee account; settle it through fees'
          : 'Fine is already settled',
      );
    const updated = await db().libraryFine.update({
      where: { id },
      data: {
        status: action,
        note: input.note ?? null,
        settledAt: new Date(),
        settledByUserId: currentPrincipal().userId ?? null,
      },
      include: fineInclude,
    });
    await audit.record({
      action: action === 'COLLECTED' ? 'library_fine.collected' : 'library_fine.waived',
      entityType: 'library_fine',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: action, amount: num(fine.amount), note: input.note ?? null },
    });
    await emit(
      LIBRARY_EVENTS.fineSettled,
      { fineId: id, status: action, amount: num(fine.amount) },
      { institutionId: fine.institutionId },
    );
    return toFineDto(updated);
  },

  /* --------------------------------- Members ------------------------------------------- */

  /** Students / employees are members automatically — list them with circulation counters. */
  async listMembers(query: ListLibraryMembersQuery) {
    const { skip, take } = toPageWindow(query);
    const scope = (await libScope()) as Record<string, unknown> | undefined;
    const search = query.search;
    let items: Array<Omit<LibraryMemberDto, 'activeLoans' | 'overdueLoans' | 'pendingFines'>>;
    let total: number;
    if (query.memberType === 'STUDENT') {
      const where = andScope<Prisma.StudentWhereInput>(
        {
          institutionId: query.institutionId,
          status: 'ACTIVE',
          ...(search
            ? {
                OR: [{ displayName: { contains: search } }, { admissionNo: { contains: search } }],
              }
            : {}),
        },
        scope as Prisma.StudentWhereInput | undefined,
      );
      const [rows, count] = await Promise.all([
        db().student.findMany({
          where,
          skip,
          take,
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          include: { classSection: { select: { name: true } } },
        }),
        db().student.count({ where }),
      ]);
      total = count;
      items = rows.map((s) => ({
        memberType: 'STUDENT' as const,
        id: s.id,
        name: s.displayName,
        code: s.admissionNo,
        institutionId: s.institutionId,
        classSection: s.classSection?.name ?? null,
      }));
    } else {
      const where = andScope<Prisma.EmployeeWhereInput>(
        {
          institutionId: query.institutionId,
          status: { notIn: ['EXITED', 'DRAFT'] },
          ...(search
            ? {
                OR: [{ displayName: { contains: search } }, { employeeCode: { contains: search } }],
              }
            : {}),
        },
        scope as Prisma.EmployeeWhereInput | undefined,
      );
      const [rows, count] = await Promise.all([
        db().employee.findMany({
          where,
          skip,
          take,
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        }),
        db().employee.count({ where }),
      ]);
      total = count;
      items = rows.map((e) => ({
        memberType: 'EMPLOYEE' as const,
        id: e.id,
        name: e.displayName,
        code: e.employeeCode,
        institutionId: e.institutionId,
      }));
    }
    const field = query.memberType === 'STUDENT' ? 'studentId' : 'employeeId';
    const ids = items.map((i) => i.id);
    const t = toDate(today());
    const [loans, overdue, fines] = ids.length
      ? await Promise.all([
          db().libraryLoan.groupBy({
            by: [field],
            where: { [field]: { in: ids }, status: 'ISSUED' },
            _count: { _all: true },
          }),
          db().libraryLoan.groupBy({
            by: [field],
            where: { [field]: { in: ids }, status: 'ISSUED', dueDate: { lt: t } },
            _count: { _all: true },
          }),
          db().libraryFine.groupBy({
            by: [field],
            where: { [field]: { in: ids }, status: 'PENDING' },
            _sum: { amount: true },
          }),
        ])
      : [[], [], []];
    const key = (r: Record<string, unknown>) => r[field] as string;
    const loanMap = new Map(loans.map((r) => [key(r), r._count._all]));
    const overdueMap = new Map(overdue.map((r) => [key(r), r._count._all]));
    const fineMap = new Map(fines.map((r) => [key(r), num(r._sum.amount)]));
    return {
      items: items.map((i): LibraryMemberDto => ({
        ...i,
        activeLoans: loanMap.get(i.id) ?? 0,
        overdueLoans: overdueMap.get(i.id) ?? 0,
        pendingFines: fineMap.get(i.id) ?? 0,
      })),
      total,
    };
  },

  async member(memberType: 'STUDENT' | 'EMPLOYEE', id: string) {
    const member = await resolveMember(
      memberType === 'STUDENT' ? { studentId: id } : { employeeId: id },
    ).catch(() => null);
    if (!member || !(await canLib('library.view', member))) throw new NotFoundError('Member');
    return memberSummary(member);
  },

  /* ------------------------------- Self-service ---------------------------------------- */

  async me(): Promise<MyLibraryDto> {
    const members = await myMembers();
    const out = [];
    for (const m of members) out.push(await memberSummary(m));
    return { members: out };
  },

  async reserveOwn(input: ReserveOwnInput) {
    const members = await myMembers();
    const book = await db().libraryBook.findUnique({ where: { id: input.bookId } });
    if (!book) throw new NotFoundError('Library book');
    const candidates = members.filter(
      (m) =>
        m.institutionId === book.institutionId &&
        (input.studentId ? m.studentId === input.studentId : true),
    );
    const member = candidates[0];
    if (!member) throw new NotFoundError('Library book');
    return reserveFor(member, book.id);
  },

  async cancelOwnReservation(id: string) {
    const members = await myMembers();
    const r = await db().libraryReservation.findUnique({ where: { id } });
    const mine =
      r &&
      members.some(
        (m) =>
          (m.studentId && m.studentId === r.studentId) ||
          (m.employeeId && m.employeeId === r.employeeId),
      );
    if (!r || !mine) throw new NotFoundError('Reservation');
    await cancelReservation(id, 'CANCELLED');
  },

  async renewOwn(id: string) {
    const members = await myMembers();
    const loan = await db().libraryLoan.findUnique({ where: { id } });
    const mine =
      loan &&
      members.some(
        (m) =>
          (m.studentId && m.studentId === loan.studentId) ||
          (m.employeeId && m.employeeId === loan.employeeId),
      );
    if (!loan || !mine) throw new NotFoundError('Library loan');
    return this.renew(id, {}, true);
  },

  /* ------------------------------- Daily job ------------------------------------------- */

  /**
   * Daily circulation sweep (per organization): due-tomorrow reminders, overdue reminders to the
   * member and (students) guardians, and expiry of READY reservations not picked up.
   */
  async runDaily(asOf = today()) {
    const stats = { dueReminders: 0, overdueReminders: 0, expired: 0 };
    const tomorrow = toDate(addDays(asOf, 1));
    const dueSoon = await db().libraryLoan.findMany({
      where: { status: 'ISSUED', dueDate: tomorrow, reminderCount: 0 },
      include: loanInclude,
    });
    for (const l of dueSoon) {
      await notify(LIBRARY_NOTIFICATIONS.dueReminder, l, {
        title: `Library book due tomorrow: ${l.book?.title ?? ''}`,
        body: `Please return or renew “${l.book?.title ?? 'the book'}” by ${dateStr(l.dueDate)}.`,
        institutionId: l.institutionId,
        data: { loanId: l.id },
      });
      stats.dueReminders++;
    }
    const policy = await policyLookup();
    const overdue = await db().libraryLoan.findMany({
      where: { status: 'ISSUED', dueDate: { lt: toDate(asOf) } },
      include: loanInclude,
    });
    for (const l of overdue) {
      const due = dateStr(l.dueDate);
      if (
        !shouldSendOverdueReminder(
          {
            dueDate: due,
            lastReminderAt: l.lastReminderAt ? dateStr(l.lastReminderAt) : null,
            reminderCount: l.reminderCount,
          },
          asOf,
        )
      )
        continue;
      const p = await policy(l.institutionId, l.memberType);
      const fine = computeOverdueFine(due, asOf, p);
      await notify(LIBRARY_NOTIFICATIONS.overdue, l, {
        title: `Overdue library book: ${l.book?.title ?? ''}`,
        body: `“${l.book?.title ?? 'The book'}” issued to ${l.memberName} was due on ${due} (${overdueDays(
          due,
          asOf,
        )} day(s) overdue). Fine so far: ₹${fine.toFixed(2)}.`,
        institutionId: l.institutionId,
        data: { loanId: l.id, fine },
      });
      await db().libraryLoan.update({
        where: { id: l.id },
        data: { reminderCount: { increment: 1 }, lastReminderAt: toDate(asOf) },
      });
      stats.overdueReminders++;
    }
    const expired = await db().libraryReservation.findMany({
      where: { status: 'READY', expiresAt: { lt: new Date() } },
      select: { id: true },
    });
    for (const r of expired) {
      await cancelReservation(r.id, 'EXPIRED');
      stats.expired++;
    }
    return stats;
  },
};

export const hasStaffLibraryAccess = () => hasPermission(currentPrincipal(), 'library.view');

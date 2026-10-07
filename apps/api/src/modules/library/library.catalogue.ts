import type { Prisma } from '@prisma/client';
import type {
  CreateLibraryBookInput,
  CreateLibraryCopiesInput,
  ListLibraryBooksQuery,
  ListLibraryCopiesQuery,
  LibraryPolicyDto,
  LibraryMemberType,
  UpdateLibraryBookInput,
  UpdateLibraryCopyInput,
  UpsertLibraryPolicyInput,
  OpacSearchQuery,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, currentPrincipal, hasPermission } from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { documentEngine } from '../../core/documents';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import type { IncomingFile } from '../../core/documents/store';
import { imageUploadPolicy } from '../employees/employees.photo';
import {
  canLib,
  libResource,
  libScope,
  loadBook,
  loadCopy,
  policyFor,
  resolveInstitution,
  type Tx,
} from './library.access';
import { LIBRARY_BOOK_OWNER, LIBRARY_EVENTS } from './library.constants';
import { formatAccessionNo, toDate } from './library.logic';
import { toBookDto, toCopyDto } from './library.mappers';
import { memberInstitutionIds } from './library.self';

const db = () => tenantDb();

async function copyCounts(bookIds: string[]) {
  const rows = bookIds.length
    ? await db().libraryCopy.groupBy({
        by: ['bookId', 'status'],
        where: { bookId: { in: bookIds } },
        _count: { _all: true },
      })
    : [];
  const out = new Map<string, { total: number; available: number }>();
  for (const r of rows) {
    const c = out.get(r.bookId) ?? { total: 0, available: 0 };
    if (r.status !== 'WITHDRAWN') c.total += r._count._all;
    if (r.status === 'AVAILABLE') c.available += r._count._all;
    out.set(r.bookId, c);
  }
  return (id: string) => out.get(id) ?? { total: 0, available: 0 };
}

async function nextAccessionNumber(tx: Tx, institutionId: string, prefix: string) {
  const last = await tx.libraryCopy.findFirst({
    where: { institutionId, accessionNo: { startsWith: `${prefix}-` } },
    orderBy: { accessionNo: 'desc' },
    select: { accessionNo: true },
  });
  const n = last ? Number.parseInt(last.accessionNo.slice(prefix.length + 1), 10) : 0;
  return Number.isFinite(n) ? n + 1 : 1;
}

export interface CopyExtras {
  shelf?: string | null;
  rack?: string | null;
  condition?: string | null;
  price?: number | null;
  acquiredOn?: string | null;
}

/** Create `count` copies (auto accession numbers) or one per explicit accession number. */
export async function createCopiesInTx(
  tx: Tx,
  book: { id: string; groupId: string | null; institutionId: string; campusId: string | null },
  prefix: string,
  count: number,
  extras: CopyExtras,
  accessionNos?: string[],
) {
  const numbers =
    accessionNos ??
    (await (async () => {
      const start = await nextAccessionNumber(tx, book.institutionId, prefix);
      return Array.from({ length: count }, (_, i) => formatAccessionNo(prefix, start + i));
    })());
  const created = [];
  for (const accessionNo of numbers) {
    created.push(
      await tx.libraryCopy.create({
        data: withTenant({
          groupId: book.groupId,
          institutionId: book.institutionId,
          campusId: book.campusId,
          bookId: book.id,
          accessionNo,
          barcode: accessionNo,
          shelf: extras.shelf ?? null,
          rack: extras.rack ?? null,
          condition: extras.condition ?? null,
          price: extras.price ?? null,
          acquiredOn: extras.acquiredOn ? toDate(extras.acquiredOn) : null,
          status: 'AVAILABLE',
        }),
      }),
    );
  }
  return created;
}

export async function withAccessionRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 2)
        throw isUniqueViolation(err)
          ? new ConflictError('Accession number / barcode already exists')
          : err;
    }
  }
}

const authorText = (authors: string[] | undefined) =>
  authors === undefined ? undefined : authors.join('; ').slice(0, 1000) || null;

function bookSearch(search: string | undefined): Prisma.LibraryBookWhereInput {
  if (!search) return {};
  return {
    OR: [
      { title: { contains: search } },
      { subtitle: { contains: search } },
      { authorText: { contains: search } },
      { isbn: { contains: search } },
      { publisher: { contains: search } },
      { category: { contains: search } },
      { callNumber: { contains: search } },
    ],
  };
}

export const catalogueService = {
  async listBooks(query: ListLibraryBooksQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.LibraryBookWhereInput>(
      {
        groupId: query.groupId,
        institutionId: query.institutionId,
        campusId: query.campusId,
        itemType: query.itemType,
        category: query.category,
        language: query.language,
        ...(query.availableOnly ? { copies: { some: { status: 'AVAILABLE' } } } : {}),
        ...bookSearch(query.search),
      },
      await libScope(),
    );
    const [rows, total] = await Promise.all([
      db().libraryBook.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: 'asc' }],
        include: { institution: { select: { id: true, name: true, code: true } } },
      }),
      db().libraryBook.count({ where }),
    ]);
    const counts = await copyCounts(rows.map((r) => r.id));
    return { items: rows.map((b) => toBookDto(b, counts(b.id))), total };
  },

  async categories(institutionId?: string) {
    const rows = await db().libraryBook.groupBy({
      by: ['category'],
      where: andScope({ institutionId }, await libScope()),
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });
    return rows
      .filter((r) => r.category)
      .map((r) => ({ category: r.category!, count: r._count._all }));
  },

  async getBook(id: string) {
    const book = await loadBook(id);
    const [inst, copies] = await Promise.all([
      db().institution.findUnique({
        where: { id: book.institutionId },
        select: { id: true, name: true, code: true },
      }),
      db().libraryCopy.findMany({ where: { bookId: id }, orderBy: { accessionNo: 'asc' } }),
    ]);
    const counts = await copyCounts([id]);
    return {
      ...toBookDto({ ...book, institution: inst }, counts(id)),
      copies: copies.map((c) => toCopyDto(c)),
    };
  },

  async createBook(input: CreateLibraryBookInput) {
    const inst = await resolveInstitution(input.institutionId, input.campusId);
    const scope = {
      groupId: inst.groupId,
      institutionId: inst.id,
      campusId: input.campusId ?? null,
    };
    await authorize(currentPrincipal(), 'library.manage', libResource(scope));
    const { copies, shelf, rack, ...fields } = input;
    const book = await withAccessionRetry(() =>
      db().$transaction(async (tx) => {
        const created = await tx.libraryBook.create({
          data: withTenant({
            ...fields,
            ...scope,
            authors: fields.authors,
            authorText: authorText(fields.authors),
            tags: fields.tags,
          }),
        });
        if (copies > 0) await createCopiesInTx(tx, created, inst.code, copies, { shelf, rack });
        return created;
      }),
    );
    await audit.record({
      action: 'library_book.created',
      entityType: 'library_book',
      entityId: book.id,
      after: { title: book.title, isbn: book.isbn, copies },
    });
    await emit(
      LIBRARY_EVENTS.bookCreated,
      { bookId: book.id, title: book.title },
      { institutionId: book.institutionId },
    );
    return this.getBook(book.id);
  },

  async updateBook(id: string, input: UpdateLibraryBookInput) {
    const before = await loadBook(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(before));
    if (input.campusId) await resolveInstitution(before.institutionId, input.campusId);
    const updated = await db().libraryBook.update({
      where: { id },
      data: {
        ...input,
        authors: input.authors,
        authorText: authorText(input.authors),
        tags: input.tags,
      },
    });
    await audit.record({
      action: 'library_book.updated',
      entityType: 'library_book',
      entityId: id,
      before: toBookDto(before),
      after: toBookDto(updated),
    });
    return this.getBook(id);
  },

  async removeBook(id: string) {
    const before = await loadBook(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(before));
    const busy = await db().libraryCopy.count({
      where: { bookId: id, status: { in: ['ISSUED', 'RESERVED'] } },
    });
    const waiting = await db().libraryReservation.count({
      where: { bookId: id, status: { in: ['WAITING', 'READY'] } },
    });
    if (busy || waiting)
      throw new ConflictError('Book has issued / reserved copies or open reservations', {
        busy,
        waiting,
      });
    await db().$transaction(async (tx) => {
      await tx.libraryCopy.updateMany({ where: { bookId: id }, data: { status: 'WITHDRAWN' } });
      await tx.libraryBook.update({ where: { id }, data: { deletedAt: new Date() } });
    });
    await audit.record({
      action: 'library_book.deleted',
      entityType: 'library_book',
      entityId: id,
      before: toBookDto(before),
    });
  },

  async uploadCover(id: string, file: IncomingFile) {
    const book = await loadBook(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(book));
    const doc = await documentEngine.attach({
      ownerType: LIBRARY_BOOK_OWNER,
      ownerId: id,
      module: 'library',
      metadata: {
        title: `Cover - ${book.title}`.slice(0, 200),
        category: 'other',
        documentType: 'library_cover',
        confidentiality: 'INTERNAL',
      },
      file,
      policy: imageUploadPolicy(3 * 1024 * 1024),
      authorization: 'caller',
    });
    await db().libraryBook.update({ where: { id }, data: { coverDocumentId: doc.id } });
    await audit.record({
      action: 'library_book.cover_updated',
      entityType: 'library_book',
      entityId: id,
      before: { coverDocumentId: book.coverDocumentId },
      after: { coverDocumentId: doc.id },
    });
    return this.getBook(id);
  },

  /** Cover bytes for staff (library.view in scope) or members of the book's institution. */
  async cover(id: string) {
    const book = await db().libraryBook.findUnique({ where: { id } });
    const visible =
      book &&
      ((await canLib('library.view', book)) ||
        (hasPermission(currentPrincipal(), 'library.view_own') &&
          (await memberInstitutionIds()).includes(book.institutionId)));
    if (!visible || !book.coverDocumentId) throw new NotFoundError('Cover');
    const file = await documentEngine.readCurrentVersion(book.coverDocumentId);
    if (!file) throw new NotFoundError('Cover');
    return { body: file.body, contentType: file.version.mimeType };
  },

  /* --------------------------------- Copies -------------------------------------------- */

  async listCopies(query: ListLibraryCopiesQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.LibraryCopyWhereInput>(
      {
        institutionId: query.institutionId,
        bookId: query.bookId,
        status: query.status,
        ...(query.search
          ? {
              OR: [
                { barcode: { contains: query.search } },
                { accessionNo: { contains: query.search } },
                { book: { title: { contains: query.search } } },
              ],
            }
          : {}),
      },
      await libScope(),
    );
    const [rows, total] = await Promise.all([
      db().libraryCopy.findMany({
        where,
        skip,
        take,
        orderBy: [{ accessionNo: 'asc' }],
        include: { book: { select: { id: true, title: true, isbn: true, callNumber: true } } },
      }),
      db().libraryCopy.count({ where }),
    ]);
    return { items: rows.map(toCopyDto), total };
  },

  async copyByBarcode(barcode: string) {
    const copy = await db().libraryCopy.findFirst({
      where: { barcode },
      include: { book: { select: { id: true, title: true, isbn: true, callNumber: true } } },
    });
    if (!copy || !(await canLib('library.view', copy))) throw new NotFoundError('Library copy');
    const loan = await db().libraryLoan.findFirst({
      where: { copyId: copy.id, status: 'ISSUED' },
    });
    return {
      ...toCopyDto(copy),
      activeLoan: loan
        ? {
            id: loan.id,
            memberName: loan.memberName,
            dueDate: loan.dueDate.toISOString().slice(0, 10),
          }
        : null,
    };
  },

  async addCopies(input: CreateLibraryCopiesInput) {
    const book = await loadBook(input.bookId);
    await authorize(currentPrincipal(), 'library.manage', libResource(book));
    const inst = await resolveInstitution(book.institutionId);
    const copies = await withAccessionRetry(() =>
      db().$transaction((tx) =>
        createCopiesInTx(tx, book, inst.code, input.count, input, input.accessionNos),
      ),
    );
    await audit.record({
      action: 'library_copy.created',
      entityType: 'library_book',
      entityId: book.id,
      after: { accessionNos: copies.map((c) => c.accessionNo) },
    });
    return copies.map((c) => toCopyDto(c));
  },

  async updateCopy(id: string, input: UpdateLibraryCopyInput) {
    const before = await loadCopy(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(before));
    if (input.status && (before.status === 'ISSUED' || before.status === 'RESERVED'))
      throw new AppError(
        409,
        'COPY_IN_CIRCULATION',
        'Return the copy or cancel its reservation before changing its status',
      );
    const updated = await db().libraryCopy.update({
      where: { id },
      data: {
        ...input,
        acquiredOn:
          input.acquiredOn === undefined
            ? undefined
            : input.acquiredOn
              ? toDate(input.acquiredOn)
              : null,
      },
    });
    await audit.record({
      action: 'library_copy.updated',
      entityType: 'library_copy',
      entityId: id,
      before: toCopyDto(before),
      after: toCopyDto(updated),
    });
    return toCopyDto(updated);
  },

  async removeCopy(id: string) {
    const before = await loadCopy(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(before));
    const loans = await db().libraryLoan.count({ where: { copyId: id } });
    const holds = await db().libraryReservation.count({ where: { copyId: id } });
    if (loans || holds)
      throw new ConflictError('Copy has circulation history; withdraw it instead', {
        loans,
        holds,
      });
    await db().libraryCopy.delete({ where: { id } });
    await audit.record({
      action: 'library_copy.deleted',
      entityType: 'library_copy',
      entityId: id,
      before: toCopyDto(before),
    });
  },

  /* --------------------------------- Policies ------------------------------------------ */

  async listPolicies(institutionId?: string) {
    const institutions = await db().institution.findMany({
      where: andScope({ id: institutionId }, await scopeInstitutions()),
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    const out: Array<LibraryPolicyDto & { institutionName: string }> = [];
    for (const inst of institutions) {
      for (const memberType of ['STUDENT', 'EMPLOYEE'] as LibraryMemberType[]) {
        const p = await policyFor(inst.id, memberType);
        out.push({ ...p, institutionId: inst.id, memberType, institutionName: inst.name });
      }
    }
    return out;
  },

  async upsertPolicy(input: UpsertLibraryPolicyInput) {
    const inst = await resolveInstitution(input.institutionId);
    const scope = { groupId: inst.groupId, institutionId: inst.id, campusId: null };
    await authorize(currentPrincipal(), 'library.manage', libResource(scope));
    const before = await policyFor(inst.id, input.memberType);
    const { institutionId, memberType, ...values } = input;
    await db().libraryPolicy.upsert({
      where: {
        organizationId_institutionId_memberType: {
          organizationId: currentOrganizationId(),
          institutionId,
          memberType,
        },
      },
      update: values,
      create: withTenant({ ...scope, memberType, ...values }),
    });
    const after = await policyFor(inst.id, memberType);
    await audit.record({
      action: 'library_policy.updated',
      entityType: 'institution',
      entityId: inst.id,
      before: { memberType, ...before },
      after: { memberType, ...after },
    });
    return { ...after, institutionId, memberType };
  },

  /* ----------------------------------- OPAC -------------------------------------------- */

  /**
   * Catalogue search for members: staff with library.view see their scope; students, parents
   * and employees see the libraries of the institutions they (or their wards) belong to.
   */
  async opac(query: OpacSearchQuery) {
    const { skip, take } = toPageWindow(query);
    const principal = currentPrincipal();
    const institutionScope = hasPermission(principal, 'library.view')
      ? await libScope()
      : { institutionId: { in: await memberInstitutionIds() } };
    const where = andScope<Prisma.LibraryBookWhereInput>(
      {
        institutionId: query.institutionId,
        itemType: query.itemType,
        category: query.category,
        ...bookSearch(query.search),
      },
      institutionScope,
    );
    const [rows, total] = await Promise.all([
      db().libraryBook.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: 'asc' }],
        include: { institution: { select: { id: true, name: true, code: true } } },
      }),
      db().libraryBook.count({ where }),
    ]);
    const counts = await copyCounts(rows.map((r) => r.id));
    return { items: rows.map((b) => toBookDto(b, counts(b.id))), total };
  },
};

/** Institutions visible for library.view, as a `where` fragment on the institution table. */
async function scopeInstitutions() {
  const scope = await libScope();
  if (!scope) return undefined;
  const visible = await db().institution.findMany({ select: { id: true, groupId: true } });
  const allowed: string[] = [];
  for (const inst of visible)
    if (
      await canLib('library.view', {
        groupId: inst.groupId,
        institutionId: inst.id,
        campusId: null,
      })
    )
      allowed.push(inst.id);
  return { id: { in: allowed } };
}

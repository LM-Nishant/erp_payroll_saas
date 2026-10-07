import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { DEMO_PASSWORD, asTenant, hasTestDatabase, seedAccessFixture, signIn } from './helpers';

/*
 * Library: catalogue, circulation (issue → overdue return with fine → reservation queue),
 * renewals, fines, self-service, plus tenant and institution-scope isolation.
 */

const LIBRARIAN = 'lib.librarian.eng@abbs.test';
const STUDENT = 'lib.student.eng@abbs.test';

type Client = Awaited<ReturnType<typeof signIn>>;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDatabase)('library', () => {
  const app = createApp();
  let owner: Client;
  let librarian: Client;
  let student: Client;
  let eng: string;
  let art: string;
  const students: Record<string, string> = {};

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    const { seedAccessControl } = await import('../prisma/seed-access');
    const extra = await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: LIBRARIAN,
          name: 'ENG Librarian',
          organization: 'abbs',
          role: 'librarian',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
        {
          email: STUDENT,
          name: 'Lib Student',
          organization: 'abbs',
          role: 'student',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
      ],
    });
    const abbs = fixture.orgIds.abbs!;
    const inst = (code: string) =>
      prisma.institution.findFirstOrThrow({ where: { organizationId: abbs, code } });
    eng = (await inst('ABBS-ENG')).id;
    art = (await inst('ABBS-ART')).id;
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    librarian = await signIn(app, LIBRARIAN, DEMO_PASSWORD);
    student = await signIn(app, STUDENT, DEMO_PASSWORD);

    const section = async (institutionId: string) =>
      (await prisma.classSection.findFirstOrThrow({ where: { institutionId } })).id;
    const engSection = await section(eng);
    const artSection = await section(art);
    const mk = async (key: string, classSectionId: string, userId?: string) => {
      const res = await owner
        .post('/api/v1/students', {
          classSectionId,
          academicYear: '2026-27',
          firstName: `Lib${key}`,
          lastName: 'Member',
          admissionNo: `LIB-${key}`,
          ...(userId ? { userId } : {}),
        })
        .expect(201);
      students[key] = res.body.data.id;
    };
    await mk('S1', engSection);
    await mk('S2', engSection, extra[STUDENT]);
    await mk('S3', engSection);
    await mk('A1', artSection);
  });
  afterAll(() => prisma.$disconnect());

  it('runs the circulation flow with fines and the reservation queue', async () => {
    await librarian
      .put('/api/v1/library/policies', {
        institutionId: eng,
        memberType: 'STUDENT',
        maxBooks: 2,
        loanDays: 7,
        maxRenewals: 1,
        finePerDay: 5,
        maxFine: 50,
        holdDays: 2,
      })
      .expect(200);
    const book = (
      await librarian
        .post('/api/v1/library/books', {
          institutionId: eng,
          title: 'Engineering Mathematics',
          authors: ['B. S. Grewal'],
          isbn: '978-8174091956',
          category: 'Mathematics',
          copies: 2,
          shelf: 'M1',
        })
        .expect(201)
    ).body.data;
    expect(book).toMatchObject({ totalCopies: 2, availableCopies: 2 });
    const [c1, c2] = book.copies as Array<{ id: string; barcode: string; accessionNo: string }>;
    expect(c1!.accessionNo).toBe('ABBS-ENG-000001');

    // OPAC search by author for the student.
    const opac = (await student.get('/api/v1/library/opac?search=Grewal').expect(200)).body;
    expect(opac.data.map((b: { id: string }) => b.id)).toContain(book.id);

    // Overdue (backdated) issue to S1 and a normal issue to S3.
    const overdueLoan = (
      await librarian
        .post('/api/v1/library/issue', {
          barcode: c1!.barcode,
          studentId: students.S1,
          issuedAt: daysAgo(20),
        })
        .expect(201)
    ).body.data;
    expect(overdueLoan).toMatchObject({ overdue: true, overdueDays: 13, fineAmount: 50 });
    const s3Loan = (
      await librarian
        .post('/api/v1/library/issue', { barcode: c2!.barcode, studentId: students.S3 })
        .expect(201)
    ).body.data;
    // Already issued copy cannot be issued again.
    await librarian
      .post('/api/v1/library/issue', { barcode: c2!.barcode, studentId: students.S1 })
      .expect(409);
    // Member of another institution cannot borrow here.
    const err = await librarian
      .post('/api/v1/library/issue', { barcode: c2!.barcode, studentId: students.A1 })
      .expect(422);
    expect(err.body.error.code).toBe('NOT_A_MEMBER');

    const overdue = (await librarian.get('/api/v1/library/loans?overdue=true').expect(200)).body;
    expect(overdue.data.map((l: { id: string }) => l.id)).toEqual([overdueLoan.id]);

    // The student (S2) reserves the title: both copies are out → queued.
    const reservation = (
      await student.post('/api/v1/library/me/reservations', { bookId: book.id }).expect(201)
    ).body.data;
    expect(reservation).toMatchObject({ status: 'WAITING', position: 1 });
    // Renewal is blocked while someone is waiting.
    const renew = await librarian.post(`/api/v1/library/loans/${s3Loan.id}/renew`).expect(422);
    expect(renew.body.error.code).toBe('BOOK_RESERVED');

    // Return of the overdue copy: capped fine + copy allocated to the reservation.
    const returned = (
      await librarian.post('/api/v1/library/return', { barcode: c1!.barcode }).expect(200)
    ).body.data;
    expect(returned.loan).toMatchObject({ status: 'RETURNED', fineAmount: 50 });
    expect(returned.fine).toMatchObject({ amount: 50, reason: 'OVERDUE', status: 'PENDING' });
    expect(returned.reservation).toMatchObject({ id: reservation.id, status: 'READY' });

    // Held copy cannot go to anybody else; the reserving student gets it.
    await librarian
      .post('/api/v1/library/issue', { barcode: c1!.barcode, studentId: students.S1 })
      .expect(409);
    await librarian
      .post('/api/v1/library/issue', { barcode: c1!.barcode, studentId: students.S2 })
      .expect(201);

    const mine = (await student.get('/api/v1/library/me').expect(200)).body.data;
    expect(mine.members).toHaveLength(1);
    expect(mine.members[0].active[0].book.title).toBe('Engineering Mathematics');
    expect(mine.members[0].reservations).toHaveLength(0);

    // Fines: student cannot settle, librarian collects once.
    await student.post(`/api/v1/library/fines/${returned.fine.id}/collect`).expect(403);
    const collected = (
      await librarian
        .post(`/api/v1/library/fines/${returned.fine.id}/collect`, { note: 'Cash' })
        .expect(200)
    ).body.data;
    expect(collected.status).toBe('COLLECTED');
    await librarian.post(`/api/v1/library/fines/${returned.fine.id}/waive`).expect(409);

    // Renewal works for S3 now that the queue is empty.
    const renewed = (await librarian.post(`/api/v1/library/loans/${s3Loan.id}/renew`).expect(200))
      .body.data;
    expect(renewed.renewCount).toBe(1);
    await librarian.post(`/api/v1/library/loans/${s3Loan.id}/renew`).expect(422);

    const report = (await librarian.get('/api/v1/library/reports/most_borrowed').expect(200)).body
      .data;
    expect(report.rows[0][1]).toBe('Engineering Mathematics');
    const csv = await librarian.get('/api/v1/library/reports/fines?format=csv').expect(200);
    expect(csv.text).toContain('OVERDUE');
    const labels = await librarian.post('/api/v1/library/labels', { bookId: book.id }).expect(200);
    expect(labels.headers['content-type']).toContain('application/pdf');

    const dash = (await librarian.get('/api/v1/library/dashboard').expect(200)).body.data;
    expect(dash).toMatchObject({ titles: 1, issued: 2 });
  });

  it('keeps libraries scoped to the institution and the tenant', async () => {
    const artBook = (
      await owner
        .post('/api/v1/library/books', { institutionId: art, title: 'Indian Polity', copies: 1 })
        .expect(201)
    ).body.data;
    // Institution-scoped librarian cannot see / manage / circulate ART.
    const list = (await librarian.get('/api/v1/library/books?pageSize=100').expect(200)).body;
    expect(list.data.map((b: { id: string }) => b.id)).not.toContain(artBook.id);
    await librarian.get(`/api/v1/library/books/${artBook.id}`).expect(404);
    await librarian
      .post('/api/v1/library/issue', { barcode: artBook.copies[0].barcode, studentId: students.A1 })
      .expect(404);
    await librarian
      .post('/api/v1/library/books', { institutionId: art, title: 'Nope', copies: 0 })
      .expect(403);
    // The ENG student does not see ART titles in OPAC.
    const opac = (await student.get('/api/v1/library/opac?pageSize=100').expect(200)).body;
    expect(opac.data.map((b: { id: string }) => b.id)).not.toContain(artBook.id);
    // Students have no staff access.
    await student.get('/api/v1/library/books').expect(403);

    // Another tenant sees nothing of ABBS.
    const other = await prisma.organization.upsert({
      where: { slug: 'library-other' },
      create: { slug: 'library-other', name: 'Library Other' },
      update: {},
    });
    await syncPlanCatalog();
    await provisionOrganizationSubscription(other.id, 'enterprise');
    const t = asTenant(app, 'library-other');
    const books = (await t.get('/api/v1/library/books').expect(200)).body;
    expect(books.meta.total).toBe(0);
    await t.get(`/api/v1/library/books/${artBook.id}`).expect(404);
    await t
      .post('/api/v1/library/issue', { barcode: artBook.copies[0].barcode, studentId: students.A1 })
      .expect(404);
  });
});

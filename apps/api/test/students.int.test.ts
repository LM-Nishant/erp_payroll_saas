import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { drainJobs } from '../src/core/queue';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asBearer,
  asTenant,
  hasTestDatabase,
  login,
  seedAccessFixture,
} from './helpers';

describe.skipIf(!hasTestDatabase)('students and admissions', () => {
  const app = createApp();
  const t = asTenant(app, 'students-org');

  beforeAll(async () => {
    const org = await prisma.organization.upsert({
      where: { slug: 'students-org' },
      create: { slug: 'students-org', name: 'Students Org' },
      update: {},
    });
    await syncPlanCatalog();
    await provisionOrganizationSubscription(org.id, 'enterprise');
  });
  afterAll(() => prisma.$disconnect());

  async function createSection() {
    const group = (
      await t.post('/api/v1/groups', { name: 'Education Group', code: 'EG' }).expect(201)
    ).body.data;
    const institution = (
      await t
        .post('/api/v1/institutions', {
          groupId: group.id,
          name: 'College',
          code: 'COL',
          type: 'COLLEGE',
        })
        .expect(201)
    ).body.data;
    const campus = (
      await t
        .post('/api/v1/campuses', { institutionId: institution.id, name: 'Main', code: 'MAIN' })
        .expect(201)
    ).body.data;
    const department = (
      await t
        .post('/api/v1/departments', {
          institutionId: institution.id,
          campusId: campus.id,
          name: 'Computer Science',
          code: 'CSE',
        })
        .expect(201)
    ).body.data;
    const program = (
      await t
        .post('/api/v1/programs', {
          departmentId: department.id,
          name: 'B.Tech CSE',
          code: 'BT-CSE',
        })
        .expect(201)
    ).body.data;
    const section = (
      await t
        .post('/api/v1/class-sections', {
          programId: program.id,
          campusId: campus.id,
          name: 'CSE A',
          code: 'A',
          academicYear: '2026-27',
        })
        .expect(201)
    ).body.data;
    return { institution, program, section };
  }

  it('submits, approves and enrolls an admission into a student with guardian history', async () => {
    const { institution, program, section } = await createSection();
    const application = (
      await t
        .post('/api/v1/admissions', {
          institutionId: institution.id,
          programId: program.id,
          classSectionId: section.id,
          academicYear: '2026-27',
          applicantFirstName: 'Aarav',
          applicantLastName: 'Sharma',
          guardianName: 'Rohit Sharma',
          guardianRelation: 'FATHER',
          guardianPhone: '+91 9876543210',
        })
        .expect(201)
    ).body.data;
    await t
      .post(`/api/v1/admissions/${application.id}/transition`, {
        status: 'APPROVED',
        comment: 'Eligible',
      })
      .expect(200);
    const enrolled = (
      await t.post(`/api/v1/admissions/${application.id}/enroll`, { rollNo: '01' }).expect(201)
    ).body.data;
    expect(enrolled.application.status).toBe('ENROLLED');
    const student = (await t.get(`/api/v1/students/${enrolled.student.id}`).expect(200)).body.data;
    expect(student).toMatchObject({ displayName: 'Aarav Sharma', rollNo: '01', status: 'ACTIVE' });
    expect(student.guardians[0].guardian.name).toBe('Rohit Sharma');
    expect(student.enrollments[0]).toMatchObject({ academicYear: '2026-27', status: 'ENROLLED' });
  });
});

describe.skipIf(!hasTestDatabase)('previous schools, transfer & character certificates', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const REGISTRAR = 'cert.registrar@abbs.test';
  const TEACHER = 'cert.teacher@abbs.test';
  const STUDENT = 'cert.student@abbs.test';
  const PARENT = 'cert.parent@abbs.test';
  const tokens: Record<string, string> = {};
  const as = (who: string) => asBearer(app, tokens[who]!);
  const uniq = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  let section: { id: string; institutionId: string; programId: string };
  let portalStudentId: string;
  let duesStudentId: string;

  /** Fetch a binary response body. */
  const binary = (who: string, url: string) =>
    supertest(app)
      .get(url)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    await syncPlanCatalog();
    await provisionOrganizationSubscription(fixture.orgIds.abbs!, 'enterprise');
    const { seedAccessControl } = await import('../prisma/seed-access');
    const scope = { type: 'INSTITUTION' as const, institution: 'ABBS-ENG' };
    const extra = await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: REGISTRAR,
          name: 'Cert Registrar',
          organization: 'abbs',
          role: 'registrar',
          scope,
        },
        { email: TEACHER, name: 'Cert Teacher', organization: 'abbs', role: 'teacher', scope },
        { email: STUDENT, name: 'Cert Student', organization: 'abbs', role: 'student', scope },
        { email: PARENT, name: 'Cert Parent', organization: 'abbs', role: 'parent', scope },
      ],
    });
    for (const [who, email] of [
      ['admin', 'eng.admin@abbs.test'],
      ['registrar', REGISTRAR],
      ['teacher', TEACHER],
      ['student', STUDENT],
      ['parent', PARENT],
    ] as const) {
      tokens[who] = (await login(app, email, DEMO_PASSWORD)).accessToken;
    }
    const program = await prisma.program.findFirstOrThrow({
      where: { organizationId: fixture.orgIds.abbs!, code: 'ABBS-ENG-BSC-CS' },
    });
    section = (
      await as('admin')
        .post('/api/v1/class-sections', {
          programId: program.id,
          name: `BSc CS Cert ${uniq}`,
          code: `CERT-${uniq}`,
          academicYear: '2026-27',
        })
        .expect(201)
    ).body.data;
    // a student linked to the student user, with a guardian linked to the parent user
    const linked = (
      await as('admin')
        .post('/api/v1/students', {
          classSectionId: section.id,
          academicYear: '2026-27',
          firstName: 'Portal',
          lastName: `Learner ${uniq}`,
          userId: extra[STUDENT],
          guardians: [{ name: 'Cert Parent', relation: 'FATHER', isPrimary: true }],
        })
        .expect(201)
    ).body.data;
    portalStudentId = linked.id;
    const detail = (await as('admin').get(`/api/v1/students/${linked.id}`).expect(200)).body.data;
    await as('admin')
      .patch(`/api/v1/students/guardians/${detail.guardians[0].guardian.id}/login`, {
        userId: extra[PARENT],
      })
      .expect(200);
    duesStudentId = (
      await as('admin')
        .post('/api/v1/students', {
          classSectionId: section.id,
          academicYear: '2026-27',
          firstName: 'Dues',
          lastName: `Learner ${uniq}`,
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await drainJobs();
  });

  it('records previous schools on an admission, carries them to the student and stores the old TC', async () => {
    const application = (
      await as('registrar')
        .post('/api/v1/admissions', {
          institutionId: section.institutionId,
          programId: section.programId,
          classSectionId: section.id,
          academicYear: '2026-27',
          applicantFirstName: 'Meera',
          applicantLastName: `Iyer ${uniq}`,
          guardianName: 'Suresh Iyer',
          guardianRelation: 'FATHER',
        })
        .expect(201)
    ).body.data;
    // strict schema
    await as('registrar')
      .post(`/api/v1/admissions/${application.id}/previous-schools`, {
        schoolName: 'X',
        bogus: 1,
      })
      .expect(400);
    const record = (
      await as('registrar')
        .post(`/api/v1/admissions/${application.id}/previous-schools`, {
          schoolName: 'St. Mary Convent',
          board: 'CBSE',
          location: 'Pune',
          lastClass: 'Grade 12',
          lastAcademicYear: '2025-2026',
          marksPercent: 88.5,
          tcNumber: 'SMC/TC/2026/117',
          tcDate: '2026-04-30',
        })
        .expect(201)
    ).body.data;
    expect(record).toMatchObject({ schoolName: 'St. Mary Convent', marksPercent: 88.5 });
    const uploaded = (
      await supertest(app)
        .post(`/api/v1/students/previous-schools/${record.id}/tc-file`)
        .set('Authorization', `Bearer ${tokens.registrar}`)
        .attach('file', Buffer.from('%PDF-1.4\n% old tc\n%%EOF\n'), {
          filename: 'old-tc.pdf',
          contentType: 'application/pdf',
        })
        .expect(200)
    ).body.data;
    expect(uploaded.tcFileName).toBe('old-tc.pdf');
    const app2 = (await as('registrar').get(`/api/v1/admissions/${application.id}`).expect(200))
      .body.data;
    expect(app2.previousSchool).toBe('St. Mary Convent');
    // teachers cannot manage admission records
    await as('teacher')
      .patch(`/api/v1/students/previous-schools/${record.id}`, { board: 'ICSE' })
      .expect((r) => expect([403, 404]).toContain(r.status));

    await as('registrar')
      .post(`/api/v1/admissions/${application.id}/transition`, { status: 'APPROVED' })
      .expect(200);
    const enrolled = (
      await as('registrar').post(`/api/v1/admissions/${application.id}/enroll`, {}).expect(201)
    ).body.data;
    const list = (
      await as('registrar')
        .get(`/api/v1/students/${enrolled.student.id}/previous-schools`)
        .expect(200)
    ).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: record.id, studentId: enrolled.student.id });

    // add + edit + delete on the student
    const second = (
      await as('registrar')
        .post(`/api/v1/students/${enrolled.student.id}/previous-schools`, {
          schoolName: 'Little Flowers Primary',
          lastClass: 'Grade 5',
          lastAcademicYear: '2018-2019',
        })
        .expect(201)
    ).body.data;
    const patched = (
      await as('registrar')
        .patch(`/api/v1/students/previous-schools/${second.id}`, { board: 'State Board' })
        .expect(200)
    ).body.data;
    expect(patched.board).toBe('State Board');
    await as('registrar').delete(`/api/v1/students/previous-schools/${second.id}`).expect(204);
    const student = (
      await as('registrar').get(`/api/v1/students/${enrolled.student.id}`).expect(200)
    ).body.data;
    expect(student.previousSchool).toBe('St. Mary Convent');
    const file = await binary(
      'registrar',
      `/api/v1/students/previous-schools/${record.id}/tc-file`,
    );
    expect(file.status).toBe(200);
    expect((file.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('issues a character certificate with a branded PDF the student and parent can download', async () => {
    const cc = (
      await as('registrar')
        .post(`/api/v1/students/${portalStudentId}/certificates`, {
          type: 'CHARACTER',
          conduct: 'Excellent',
          remarks: 'Active in sports',
        })
        .expect(201)
    ).body.data;
    expect(cc).toMatchObject({ type: 'CHARACTER', status: 'ISSUED', conduct: 'Excellent' });
    expect(cc.certificateNo).toMatch(/^ABBS-ENG\/CC\/\d{4}\/\d{4}$/);
    expect(cc.documentId).toBeTruthy();
    expect(cc.issuedByName).toBe('Cert Registrar');

    const pdf = await binary('registrar', `/api/v1/students/certificates/${cc.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const mine = (await as('student').get('/api/v1/students/me/certificates').expect(200)).body
      .data;
    expect(mine.map((c: { id: string }) => c.id)).toContain(cc.id);
    expect((await binary('student', `/api/v1/students/certificates/${cc.id}/pdf`)).status).toBe(
      200,
    );
    const wards = (await as('parent').get('/api/v1/students/my-wards/certificates').expect(200))
      .body.data;
    expect(wards.map((c: { id: string }) => c.id)).toContain(cc.id);
    expect((await binary('parent', `/api/v1/students/certificates/${cc.id}/pdf`)).status).toBe(200);
    // a teacher (no certificate permission) cannot download
    expect((await binary('teacher', `/api/v1/students/certificates/${cc.id}/pdf`)).status).toBe(
      403,
    );
    // nor can staff list/issue without permission
    await as('teacher').get(`/api/v1/students/${portalStudentId}/certificates`).expect(403);

    // cancelled certificates disappear from the portal
    await as('registrar')
      .post(`/api/v1/students/certificates/${cc.id}/cancel`, { reason: 'Typo in remarks' })
      .expect(200);
    const after = (await as('student').get('/api/v1/students/me/certificates').expect(200)).body
      .data;
    expect(after.map((c: { id: string }) => c.id)).not.toContain(cc.id);
    expect((await binary('student', `/api/v1/students/certificates/${cc.id}/pdf`)).status).toBe(
      404,
    );
    await as('registrar')
      .post(`/api/v1/students/certificates/${cc.id}/cancel`, { reason: 'again' })
      .expect(409);
  });

  it('blocks a TC while fee dues are pending unless the principal-level waiver is used', async () => {
    await as('admin')
      .post('/api/v1/fees/heads', {
        institutionId: section.institutionId,
        code: `TCD${uniq}`.slice(0, 20).toUpperCase(),
        name: 'TC dues test head',
        category: 'MISC',
      })
      .expect(201);
    await as('admin')
      .post('/api/v1/fees/charges', {
        studentId: duesStudentId,
        feeHeadCode: `TCD${uniq}`.slice(0, 20).toUpperCase(),
        amount: 1500,
        dueDate: today,
        sourceType: 'MANUAL',
        sourceId: `tc-${uniq}`,
      })
      .expect(201);

    const eligibility = (
      await as('registrar')
        .get(`/api/v1/students/${duesStudentId}/certificates/eligibility?type=TRANSFER`)
        .expect(200)
    ).body.data;
    expect(eligibility).toMatchObject({ feeDues: 1500, duesChecked: true, canWaiveDues: false });

    const tc = {
      type: 'TRANSFER',
      leavingDate: today,
      reason: 'Relocation',
      conduct: 'Good',
    };
    // leaving date is required for a TC
    await as('registrar')
      .post(`/api/v1/students/${duesStudentId}/certificates`, { type: 'TRANSFER', conduct: 'Good' })
      .expect(400);
    const blocked = await as('registrar')
      .post(`/api/v1/students/${duesStudentId}/certificates`, tc)
      .expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'FEE_DUES_PENDING',
      details: { amount: 1500, invoiceCount: 1 },
    });
    // the registrar may not waive
    await as('registrar')
      .post(`/api/v1/students/${duesStudentId}/certificates`, {
        ...tc,
        waiveFeeDues: true,
        waiverReason: 'Hardship',
      })
      .expect(403);
    // the institution admin (waive permission) can, with a reason
    const issued = (
      await as('admin')
        .post(`/api/v1/students/${duesStudentId}/certificates`, {
          ...tc,
          waiveFeeDues: true,
          waiverReason: 'Hardship case approved',
        })
        .expect(201)
    ).body.data;
    expect(issued).toMatchObject({
      type: 'TRANSFER',
      feeDuesAmount: 1500,
      feeDuesWaived: true,
      leavingDate: today,
    });
    expect(issued.certificateNo).toMatch(/^ABBS-ENG\/TC\/\d{4}\/\d{4}$/);
    const student = (await as('admin').get(`/api/v1/students/${duesStudentId}`).expect(200)).body
      .data;
    expect(student.status).toBe('WITHDRAWN');
    expect(student.enrollments[0]).toMatchObject({ status: 'WITHDRAWN', toDate: today });
    // only one issued TC per student
    await as('admin')
      .post(`/api/v1/students/${duesStudentId}/certificates`, {
        ...tc,
        waiveFeeDues: true,
        waiverReason: 'x',
      })
      .expect(409);
  });

  it('cancels and reissues a TC with a new number that points back to the old one', async () => {
    const tc = (
      await as('registrar')
        .post(`/api/v1/students/${portalStudentId}/certificates`, {
          type: 'TRANSFER',
          leavingDate: today,
          reason: 'Moving abroad',
          conduct: 'Very good',
        })
        .expect(201)
    ).body.data;
    expect(tc.feeDuesAmount).toBe(0);
    const reissued = (
      await as('registrar')
        .post(`/api/v1/students/certificates/${tc.id}/reissue`, {
          reason: 'Wrong leaving reason',
          leavingReason: 'Family relocation to Dubai',
        })
        .expect(201)
    ).body.data;
    expect(reissued.certificateNo).not.toBe(tc.certificateNo);
    expect(reissued).toMatchObject({
      replacesId: tc.id,
      reason: 'Family relocation to Dubai',
      conduct: 'Very good',
      status: 'ISSUED',
    });
    const list = (
      await as('registrar').get(`/api/v1/students/${portalStudentId}/certificates`).expect(200)
    ).body.data as Array<{ id: string; status: string; replacedById: string | null }>;
    const old = list.find((c) => c.id === tc.id)!;
    expect(old).toMatchObject({ status: 'CANCELLED', replacedById: reissued.id });
    // the cancelled one cannot be reissued again
    await as('registrar')
      .post(`/api/v1/students/certificates/${tc.id}/reissue`, { reason: 'again' })
      .expect(409);
    // the reissued TC is downloadable by the student
    expect(
      (await binary('student', `/api/v1/students/certificates/${reissued.id}/pdf`)).status,
    ).toBe(200);
    // and the audit trail records issue / cancel
    const actions = await prisma.auditLog.findMany({
      where: { entityId: { in: [tc.id, reissued.id] } },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['student.certificate_issued', 'student.certificate_cancelled']),
    );
  });
});

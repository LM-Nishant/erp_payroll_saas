import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { drainJobs } from '../src/core/queue';
import { DEMO_PASSWORD, TEST_AUTH_RATE_LIMIT, seedAccessFixture, signIn } from './helpers';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

const TEACHER = 'acad.teacher@abbs.test';
const OTHER_TEACHER = 'acad.other@abbs.test';
const STUDENT = 'acad.student@abbs.test';
const PARENT = 'acad.parent@abbs.test';

type Client = Awaited<ReturnType<typeof signIn>>;

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!hasTestDatabase)('academics: subjects, timetable, attendance, exams', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let admin: Client;
  let teacher: Client;
  let other: Client;
  let userIds: Record<string, string>;
  let sectionA: { id: string; institutionId: string; programId: string };
  let sectionB: { id: string };
  const studentIds: string[] = [];
  let studentUserStudentId: string;
  const subjects: { id: string; code: string }[] = [];

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    await syncPlanCatalog();
    await provisionOrganizationSubscription(fixture.orgIds.abbs!, 'enterprise');
    await provisionOrganizationSubscription(fixture.orgIds.bcc!, 'enterprise');
    const { seedAccessControl } = await import('../prisma/seed-access');
    const scope = { type: 'INSTITUTION' as const, institution: 'ABBS-ENG' };
    const extra = await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        { email: TEACHER, name: 'Acad Teacher', organization: 'abbs', role: 'teacher', scope },
        {
          email: OTHER_TEACHER,
          name: 'Other Teacher',
          organization: 'abbs',
          role: 'teacher',
          scope,
        },
        { email: STUDENT, name: 'Acad Student', organization: 'abbs', role: 'student', scope },
        { email: PARENT, name: 'Acad Parent', organization: 'abbs', role: 'parent', scope },
      ],
    });
    userIds = { ...fixture.userIds, ...extra };
    admin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    teacher = await signIn(app, TEACHER, DEMO_PASSWORD);
    other = await signIn(app, OTHER_TEACHER, DEMO_PASSWORD);

    const program = await prisma.program.findFirstOrThrow({
      where: { organizationId: fixture.orgIds.abbs!, code: 'ABBS-ENG-BSC-CS' },
    });
    const mk = async (code: string) =>
      (
        await admin
          .post('/api/v1/class-sections', {
            programId: program.id,
            name: `BSc CS ${code}`,
            code: `ACAD-${code}-${Date.now().toString(36)}`,
            academicYear: '2026-27',
          })
          .expect(201)
      ).body.data;
    sectionA = await mk('A');
    sectionB = await mk('B');
    for (let i = 1; i <= 3; i += 1) {
      const s = (
        await admin
          .post('/api/v1/students', {
            classSectionId: sectionA.id,
            academicYear: '2026-27',
            rollNo: `0${i}`,
            firstName: `Learner${i}`,
            lastName: 'Acad',
            ...(i === 1
              ? {
                  userId: userIds[STUDENT],
                  guardians: [{ name: 'Acad Parent', relation: 'MOTHER', isPrimary: true }],
                }
              : {}),
          })
          .expect(201)
      ).body.data;
      studentIds.push(s.id);
    }
    studentUserStudentId = studentIds[0]!;
    const detail = (await admin.get(`/api/v1/students/${studentUserStudentId}`).expect(200)).body
      .data;
    await admin
      .patch(`/api/v1/students/guardians/${detail.guardians[0].guardian.id}/login`, {
        userId: userIds[PARENT],
      })
      .expect(200);
  });

  afterAll(async () => {
    await drainJobs();
  });

  it('manages subjects and allocations; teachers act only on allocated sections', async () => {
    for (const [code, name, type] of [
      ['MTH', 'Mathematics', 'THEORY'],
      ['PHY', 'Physics', 'THEORY'],
      ['PRL', 'Physics Lab', 'PRACTICAL'],
    ] as const) {
      const s = (
        await admin
          .post('/api/v1/subjects', {
            programId: sectionA.programId,
            code: `${code}${Date.now().toString(36)}`,
            name,
            type,
            credits: type === 'PRACTICAL' ? 2 : 4,
            maxMarks: type === 'PRACTICAL' ? 50 : 100,
            passMarks: type === 'PRACTICAL' ? 18 : 35,
          })
          .expect(201)
      ).body.data;
      subjects.push(s);
    }
    const list = (
      await admin.get(`/api/v1/subjects?classSectionId=${sectionA.id}&pageSize=100`).expect(200)
    ).body;
    expect(list.data.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining(subjects.map((s) => s.id)),
    );
    // teacher can view but not manage subjects
    await teacher
      .post('/api/v1/subjects', { programId: sectionA.programId, code: 'X1', name: 'X' })
      .expect(403);

    for (const s of subjects) {
      await admin
        .post('/api/v1/subject-allocations', {
          classSectionId: sectionA.id,
          subjectId: s.id,
          teacherUserId: userIds[TEACHER],
        })
        .expect(201);
    }
    await admin
      .put('/api/v1/subject-allocations/class-teacher', {
        classSectionId: sectionA.id,
        teacherUserId: userIds[TEACHER],
      })
      .expect(200);

    const mine = (await teacher.get('/api/v1/subject-allocations/my-classes').expect(200)).body
      .data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ isClassTeacher: true, studentCount: 3 });
    expect(mine[0].subjects).toHaveLength(3);
  });

  it('builds a timetable with clash detection and substitutions', async () => {
    const periods = (
      await admin
        .put('/api/v1/timetable/periods', {
          institutionId: sectionA.institutionId,
          periods: [
            { seq: 1, name: 'P1', startTime: '09:00', endTime: '09:45' },
            { seq: 2, name: 'P2', startTime: '09:45', endTime: '10:30' },
            { seq: 3, name: 'Break', startTime: '10:30', endTime: '10:45', isBreak: true },
          ],
        })
        .expect(200)
    ).body.data as { id: string; seq: number }[];
    const p1 = periods.find((p) => p.seq === 1)!.id;
    const p2 = periods.find((p) => p.seq === 2)!.id;

    const tt = (
      await admin
        .put(`/api/v1/timetable/sections/${sectionA.id}`, {
          entries: [
            {
              dayOfWeek: 1,
              periodId: p1,
              subjectId: subjects[0]!.id,
              teacherUserId: userIds[TEACHER],
              room: 'R101',
            },
            {
              dayOfWeek: 1,
              periodId: p2,
              subjectId: subjects[1]!.id,
              teacherUserId: userIds[TEACHER],
              room: 'R101',
            },
          ],
        })
        .expect(200)
    ).body.data;
    expect(tt.entries).toHaveLength(2);
    expect(tt.clashes).toEqual([]);

    // Section B double-books the teacher on Monday P1 → 409 unless allowClashes
    const clash = await admin
      .put(`/api/v1/timetable/sections/${sectionB.id}`, {
        entries: [
          {
            dayOfWeek: 1,
            periodId: p1,
            subjectId: subjects[0]!.id,
            teacherUserId: userIds[TEACHER],
            room: 'R202',
          },
        ],
      })
      .expect(409);
    expect(clash.body.error.code).toBe('TIMETABLE_CLASH');
    await admin
      .put(`/api/v1/timetable/sections/${sectionB.id}`, {
        entries: [
          {
            dayOfWeek: 1,
            periodId: p1,
            subjectId: subjects[0]!.id,
            teacherUserId: userIds[OTHER_TEACHER],
            room: 'R202',
          },
        ],
      })
      .expect(200);

    const teacherView = (await teacher.get('/api/v1/timetable/teacher').expect(200)).body.data;
    expect(teacherView.entries).toHaveLength(2);

    // next Monday
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    const monday = d.toISOString().slice(0, 10);
    const entryId = tt.entries.find((e: { periodId: string }) => e.periodId === p2).id;
    await admin
      .post('/api/v1/timetable/substitutions', {
        entryId,
        date: monday,
        substituteUserId: userIds[OTHER_TEACHER],
        reason: 'On leave',
      })
      .expect(201);
    const onDay = (
      await admin.get(`/api/v1/timetable/sections/${sectionA.id}?date=${monday}`).expect(200)
    ).body.data;
    expect(onDay.entries.find((e: { id: string }) => e.id === entryId).substitute.id).toBe(
      userIds[OTHER_TEACHER],
    );

    const student = await signIn(app, STUDENT, DEMO_PASSWORD);
    const mineTt = (await student.get('/api/v1/timetable/me').expect(200)).body.data;
    expect(mineTt.entries).toHaveLength(2);
  });

  it('marks attendance within the edit window and notifies guardians', async () => {
    const today = isoDaysAgo(0);
    const records = (absent: boolean) =>
      studentIds.map((id, i) => ({
        studentId: id,
        status: i === 0 && absent ? 'ABSENT' : 'PRESENT',
      }));
    // not allocated → 403
    await other
      .post('/api/v1/student-attendance', {
        classSectionId: sectionA.id,
        date: today,
        records: records(false),
      })
      .expect(403);
    await teacher
      .post('/api/v1/student-attendance', {
        classSectionId: sectionA.id,
        date: today,
        records: records(true),
      })
      .expect(200);
    await teacher
      .post('/api/v1/student-attendance', {
        classSectionId: sectionA.id,
        date: isoDaysAgo(1),
        records: records(false),
      })
      .expect(200);
    // outside the edit window for a teacher, allowed for a manager
    const old = isoDaysAgo(10);
    await teacher
      .post('/api/v1/student-attendance', {
        classSectionId: sectionA.id,
        date: old,
        records: records(false),
      })
      .expect(422);
    await admin
      .post('/api/v1/student-attendance', {
        classSectionId: sectionA.id,
        date: old,
        records: records(false),
      })
      .expect(200);

    const jobs = await prisma.notificationJob.findMany({
      where: { eventKey: 'student_attendance.absent' },
    });
    expect(
      jobs.some((j) =>
        ((j.payload as { recipients: string[] }).recipients ?? []).includes(userIds[PARENT]!),
      ),
    ).toBe(true);

    const register = (
      await admin
        .get(
          `/api/v1/student-attendance/register?classSectionId=${sectionA.id}&month=${today.slice(0, 7)}`,
        )
        .expect(200)
    ).body.data;
    expect(register.students).toHaveLength(3);

    const parent = await signIn(app, PARENT, DEMO_PASSWORD);
    const own = (await parent.get('/api/v1/student-attendance/me').expect(200)).body.data;
    expect(own.student.id).toBe(studentUserStudentId);
    expect(own.overall.workingDays).toBe(3);
    expect(own.overall.absent).toBe(1);
  });

  it('runs an exam term end to end: schedule, marks, lock, compute, publish, report card', async () => {
    const term = (
      await admin
        .post('/api/v1/exams/terms', {
          institutionId: sectionA.institutionId,
          name: 'Unit Test 1',
          type: 'UNIT_TEST',
          academicYear: '2026-27',
          startDate: isoDaysAgo(5),
          endDate: isoDaysAgo(0),
        })
        .expect(201)
    ).body.data;
    const papers = (
      await admin
        .put(`/api/v1/exams/terms/${term.id}/schedules`, {
          schedules: subjects.map((s, i) => ({
            classSectionId: sectionA.id,
            subjectId: s.id,
            examDate: isoDaysAgo(5 - i),
          })),
        })
        .expect(200)
    ).body.data as { id: string; subjectId: string; maxMarks: number }[];
    expect(papers).toHaveLength(3);
    expect(papers.find((p) => p.subjectId === subjects[2]!.id)!.maxMarks).toBe(50);

    const mine = (
      await teacher.get(`/api/v1/exams/terms/${term.id}/schedules?mine=true`).expect(200)
    ).body.data;
    expect(mine).toHaveLength(3);
    const otherMine = (
      await other.get(`/api/v1/exams/terms/${term.id}/schedules?mine=true`).expect(200)
    ).body.data;
    expect(otherMine).toHaveLength(0);

    const scores = [
      [95, 88, 45],
      [60, 30, 40],
      [95, 88, 45],
    ];
    for (const [pi, paper] of papers.entries()) {
      // unallocated teacher cannot enter marks
      await other
        .put(`/api/v1/exams/schedules/${paper.id}/marks`, {
          marks: [{ studentId: studentIds[0], marks: 10 }],
        })
        .expect(403);
      const idx = subjects.findIndex((s) => s.id === paper.subjectId);
      await teacher
        .put(`/api/v1/exams/schedules/${paper.id}/marks`, {
          marks: studentIds.map((id, si) => ({ studentId: id, marks: scores[si]![idx] })),
        })
        .expect(200);
      void pi;
    }
    await teacher
      .put(`/api/v1/exams/schedules/${papers[0]!.id}/marks`, {
        marks: [{ studentId: studentIds[0], marks: 500 }],
      })
      .expect(422);

    await admin.post(`/api/v1/exams/terms/${term.id}/compute`, {}).expect(200);
    // publishing requires all papers locked
    await admin.post(`/api/v1/exams/terms/${term.id}/publish`, {}).expect(409);
    for (const p of papers) {
      await teacher.post(`/api/v1/exams/schedules/${p.id}/lock`, { locked: true }).expect(200);
    }
    await teacher
      .put(`/api/v1/exams/schedules/${papers[0]!.id}/marks`, {
        marks: [{ studentId: studentIds[0], marks: 90 }],
      })
      .expect(409);

    // student cannot see unpublished results
    const student = await signIn(app, STUDENT, DEMO_PASSWORD);
    expect((await student.get('/api/v1/exams/my-results').expect(200)).body.data.results).toEqual(
      [],
    );
    await student
      .get(`/api/v1/exams/my-results/${term.id}/report-card/${studentUserStudentId}`)
      .expect(404);

    await admin.post(`/api/v1/exams/terms/${term.id}/compute`, {}).expect(200);
    const published = (await admin.post(`/api/v1/exams/terms/${term.id}/publish`, {}).expect(200))
      .body.data;
    expect(published.status).toBe('PUBLISHED');

    const results = (await admin.get(`/api/v1/exams/terms/${term.id}/results`).expect(200)).body
      .data as { studentId: string; rank: number; passed: boolean; percentage: number }[];
    const byStudent = new Map(results.map((r) => [r.studentId, r]));
    expect(byStudent.get(studentIds[0]!)).toMatchObject({ rank: 1, passed: true });
    expect(byStudent.get(studentIds[2]!)!.rank).toBe(1);
    expect(byStudent.get(studentIds[1]!)).toMatchObject({ rank: 3, passed: false });

    const own = (await student.get('/api/v1/exams/my-results').expect(200)).body.data;
    expect(own.results).toHaveLength(1);
    expect(own.cgpa).toBeGreaterThan(9);

    const pdf = await student
      .get(`/api/v1/exams/my-results/${term.id}/report-card/${studentUserStudentId}`)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    // another student's card is not reachable through self-service
    await student
      .get(`/api/v1/exams/my-results/${term.id}/report-card/${studentIds[1]}`)
      .expect(404);
    await admin.get(`/api/v1/exams/terms/${term.id}/report-card/${studentIds[1]}`).expect(200);

    const jobs = await prisma.notificationJob.findMany({
      where: { eventKey: 'exam.results_published' },
    });
    const recipients = jobs.flatMap((j) => (j.payload as { recipients: string[] }).recipients);
    expect(recipients).toEqual(expect.arrayContaining([userIds[STUDENT], userIds[PARENT]]));
  });

  it('isolates tenants and scopes', async () => {
    const bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    const subjectsBcc = (await bcc.get('/api/v1/subjects?pageSize=100').expect(200)).body.data;
    expect(subjectsBcc.map((s: { id: string }) => s.id)).not.toContain(subjects[0]!.id);
    await bcc.get(`/api/v1/timetable/sections/${sectionA.id}`).expect(404);
    const terms = (await bcc.get('/api/v1/exams/terms').expect(200)).body.data;
    expect(terms).toEqual([]);
    await bcc
      .get(`/api/v1/student-attendance/section?classSectionId=${sectionA.id}&date=${isoDaysAgo(0)}`)
      .expect(404);
    // a principal of another ABBS institution does not see ENG rows
    const com = await prisma.institution.findFirstOrThrow({ where: { code: 'ABBS-COM' } });
    const scoped = (await admin.get(`/api/v1/exams/terms?institutionId=${com.id}`).expect(200)).body
      .data;
    expect(scoped).toEqual([]);
  });
});

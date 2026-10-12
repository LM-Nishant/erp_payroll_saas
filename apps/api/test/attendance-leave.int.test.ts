import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { drainJobs, runAsSystem } from '../src/core/queue';
import { attendanceSummaryForPeriod } from '../src/modules/attendance/attendance.summary';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  login,
  seedAccessFixture,
  signIn,
} from './helpers';

/*
 * Layer 7: holidays, shifts, attendance, leave and the payroll feed. All scenarios use March 2025
 * (Asia/Kolkata): Sun 2/9/16/23/30, Sat 8 (2nd) and 22 (4th) are weekly offs with the org pattern.
 */

const SELF = 'l7.self@abbs.test';
const MANAGER = 'l7.manager@abbs.test';

type Client = Awaited<ReturnType<typeof signIn>>;
type Day = { date: string; kind: string; name: string; institutionId: string | null };
type Rec = { date: string; status: string; [k: string]: unknown };

describe.skipIf(!hasTestDatabase)('Attendance, leave, holidays and shifts', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let abbs: string;
  let userIds: Record<string, string>;
  let eng: string;
  let com: string;
  let engCse: string;
  let engCom: string;
  let comCom: string;
  let groupId: string;
  let owner: Client;
  let groupHr: Client;
  let engHr: Client;
  let self: Client;
  let manager: Client;
  let seq = 0;

  // Employees
  let A: { id: string; employeeCode: string }; // eng, self-service user, reports to M
  let M: { id: string };
  let B: { id: string }; // com
  let T: { id: string }; // eng -> com on 2025-03-16
  let N: { id: string; employeeCode: string }; // eng, night shift
  let R: { id: string }; // eng, rotation
  let D: { id: string }; // eng / COM department (department shift)
  let J: { id: string }; // joined 2025-01-16 (pro-rata)

  // Shifts / leave types
  let gen: { id: string };
  let night: { id: string };
  let cl: { id: string };
  let el: { id: string };
  let lwp: { id: string };

  const name = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1)}`;
  const createEmployee = async (body: Record<string, unknown>, who: Client = groupHr) =>
    (
      await who
        .post('/api/v1/employees', {
          employmentType: 'TEACHING',
          firstName: name('Att'),
          lastName: 'Test',
          status: 'ACTIVE',
          dateOfJoining: '2024-01-01',
          ...body,
        })
        .expect(201)
    ).body.data;
  const records = async (employeeId: string, from: string, to: string, who: Client = engHr) => {
    const res = await who
      .get(`/api/v1/attendance/records?employeeId=${employeeId}&from=${from}&to=${to}&pageSize=100`)
      .expect(200);
    return Object.fromEntries((res.body.data as Rec[]).map((r) => [r.date, r]));
  };
  const resolveDays = async (employeeId: string, from: string, to: string) =>
    (
      await groupHr
        .get(`/api/v1/holidays/resolve?employeeId=${employeeId}&from=${from}&to=${to}`)
        .expect(200)
    ).body.data as Day[];
  const summary = async (employeeId: string, from: string, to: string, who: Client = engHr) =>
    (
      await who
        .get(`/api/v1/attendance/summary?employeeId=${employeeId}&from=${from}&to=${to}`)
        .expect(200)
    ).body.data[0];
  const balanceOf = async (employeeId: string, leaveTypeId: string, asOf: string) => {
    const rows = (
      await engHr.get(`/api/v1/leave/balances?employeeId=${employeeId}&asOf=${asOf}`).expect(200)
    ).body.data as { leaveTypeId: string; balance: number; available: number; pending: number }[];
    return rows.find((r) => r.leaveTypeId === leaveTypeId);
  };
  const punch = (code: string, at: string, direction = 'UNKNOWN') => ({
    employeeCode: code,
    punchedAt: at,
    direction,
  });
  const archive = (id: string) =>
    prisma.workflowDefinition.update({ where: { id }, data: { status: 'ARCHIVED' } });

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    abbs = fixture.orgIds.abbs!;
    const { seedAccessControl } = await import('../prisma/seed-access');
    const extra = await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: SELF,
          name: 'L7 Self',
          organization: 'abbs',
          role: 'employee',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
        {
          email: MANAGER,
          name: 'L7 Manager',
          organization: 'abbs',
          role: 'employee',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
      ],
    });
    userIds = { ...fixture.userIds, ...extra };
    const inst = async (code: string) =>
      prisma.institution.findFirstOrThrow({ where: { organizationId: abbs, code } });
    const engRow = await inst('ABBS-ENG');
    eng = engRow.id;
    groupId = engRow.groupId!;
    com = (await inst('ABBS-COM')).id;
    const dept = async (institutionId: string, code: string) =>
      (await prisma.department.findFirstOrThrow({ where: { institutionId, code } })).id;
    engCse = await dept(eng, 'CSE');
    engCom = await dept(eng, 'COM');
    comCom = await dept(com, 'COM');
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    groupHr = await signIn(app, 'group.hr@abbs.test', DEMO_PASSWORD);
    engHr = await signIn(app, 'eng.hr@abbs.test', DEMO_PASSWORD);
    self = await signIn(app, SELF, DEMO_PASSWORD);
    manager = await signIn(app, MANAGER, DEMO_PASSWORD);

    M = await createEmployee({
      institutionId: eng,
      departmentId: engCse,
      userId: userIds[MANAGER],
      dateOfJoining: '2023-01-01',
    });
    A = await createEmployee({
      institutionId: eng,
      departmentId: engCse,
      userId: userIds[SELF],
      reportingManagerId: M.id,
    });
    B = await createEmployee({ institutionId: com, departmentId: comCom });
    T = await createEmployee({ institutionId: eng, departmentId: engCse });
    N = await createEmployee({ institutionId: eng, departmentId: engCse });
    R = await createEmployee({ institutionId: eng, departmentId: engCse });
    D = await createEmployee({ institutionId: eng, departmentId: engCom });
    J = await createEmployee({
      institutionId: eng,
      departmentId: engCse,
      dateOfJoining: '2025-01-16',
    });
    // Transfer T to COM from 2025-03-16 (no transfer workflow defined -> applied directly).
    await groupHr
      .post(`/api/v1/employees/${T.id}/movements`, {
        type: 'TRANSFER',
        effectiveDate: '2025-03-16',
        toInstitutionId: com,
        toDepartmentId: comCom,
        reason: 'Transfer to commerce',
      })
      .expect(201);
  });

  afterAll(async () => {
    await drainJobs();
  });

  it('registers workflow entity types', async () => {
    const types = (await owner.get('/api/v1/workflows/entity-types').expect(200)).body.data;
    expect(types.map((t: { entityType: string }) => t.entityType)).toEqual(
      expect.arrayContaining(['leave_request', 'attendance_regularization']),
    );
  });

  describe('holiday calendars', () => {
    it('inherits org -> group -> institution with per-institution calendars and overrides', async () => {
      const org = (
        await owner
          .post('/api/v1/holidays/calendars', {
            scope: 'ORGANIZATION',
            year: 2025,
            name: 'ABBS 2025',
            weeklyOffs: [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }],
          })
          .expect(201)
      ).body.data;
      for (const [date, n] of [
        ['2025-03-14', 'Holi'],
        ['2025-03-31', 'Eid'],
      ]) {
        await owner
          .post(`/api/v1/holidays/calendars/${org.id}/holidays`, { date, name: n })
          .expect(201);
      }
      const group = (
        await owner
          .post('/api/v1/holidays/calendars', {
            scope: 'GROUP',
            targetId: groupId,
            year: 2025,
            name: 'Group 2025',
          })
          .expect(201)
      ).body.data;
      await owner
        .post(`/api/v1/holidays/calendars/${group.id}/holidays`, {
          date: '2025-03-25',
          name: 'Group Day',
        })
        .expect(201);

      // Institution HR manages its own calendar only.
      await engHr
        .post('/api/v1/holidays/calendars', {
          scope: 'INSTITUTION',
          targetId: com,
          year: 2025,
          name: 'COM 2025',
        })
        .expect(403);
      await engHr
        .post('/api/v1/holidays/calendars', { scope: 'ORGANIZATION', year: 2026, name: 'Nope' })
        .expect(403);
      const engCal = (
        await engHr
          .post('/api/v1/holidays/calendars', {
            scope: 'INSTITUTION',
            targetId: eng,
            year: 2025,
            name: 'ENG 2025',
          })
          .expect(201)
      ).body.data;
      await engHr
        .post(`/api/v1/holidays/calendars/${engCal.id}/holidays`, {
          date: '2025-03-05',
          name: 'Foundation Day',
        })
        .expect(201);
      await engHr
        .post(`/api/v1/holidays/calendars/${engCal.id}/holidays`, {
          date: '2025-03-26',
          name: 'Regional festival',
          type: 'RESTRICTED',
        })
        .expect(201);
      // Override: ENG works on Eid.
      await engHr
        .post(`/api/v1/holidays/calendars/${engCal.id}/holidays`, {
          date: '2025-03-31',
          name: 'Eid (working)',
          removed: true,
        })
        .expect(201);
      const comCal = (
        await groupHr
          .post('/api/v1/holidays/calendars', {
            scope: 'INSTITUTION',
            targetId: com,
            year: 2025,
            name: 'COM 2025',
          })
          .expect(201)
      ).body.data;
      await groupHr
        .post(`/api/v1/holidays/calendars/${comCal.id}/holidays`, {
          date: '2025-03-20',
          name: 'Commerce Day',
        })
        .expect(201);

      const engDays = await resolveDays(A.id, '2025-03-01', '2025-03-31');
      const kinds = (days: Day[], kind: string) =>
        days.filter((d) => d.kind === kind).map((d) => d.date.slice(8));
      expect(kinds(engDays, 'HOLIDAY')).toEqual(['05', '14', '25']);
      expect(kinds(engDays, 'WEEKLY_OFF')).toEqual(['02', '08', '09', '16', '22', '23', '30']);
      expect(kinds(engDays, 'RESTRICTED')).toEqual(['26']);

      const comDays = await resolveDays(B.id, '2025-03-01', '2025-03-31');
      expect(kinds(comDays, 'HOLIDAY')).toEqual(['14', '20', '25', '31']);
    });

    it('uses the as-of institution calendar for a transferred employee', async () => {
      const days = await resolveDays(T.id, '2025-03-01', '2025-03-31');
      const holidays = days.filter((d) => d.kind === 'HOLIDAY');
      expect(holidays.map((d) => [d.date.slice(8), d.institutionId])).toEqual([
        ['05', eng],
        ['14', eng],
        ['20', com],
        ['25', com],
        ['31', com],
      ]);
    });
  });

  describe('shifts', () => {
    it('resolves employee, department, rotation and institution-default shifts', async () => {
      gen = (
        await engHr
          .post('/api/v1/shifts', {
            institutionId: eng,
            code: 'GEN',
            name: 'General',
            startMinute: 540,
            endMinute: 1020,
            graceInMinutes: 10,
            graceOutMinutes: 10,
            breakMinutes: 30,
            halfDayMinutes: 240,
            fullDayMinutes: 420,
            isDefault: true,
          })
          .expect(201)
      ).body.data;
      night = (
        await engHr
          .post('/api/v1/shifts', {
            institutionId: eng,
            code: 'NGT',
            name: 'Night',
            startMinute: 1320,
            endMinute: 360,
            breakMinutes: 30,
            halfDayMinutes: 240,
            fullDayMinutes: 420,
          })
          .expect(201)
      ).body.data;
      expect((night as { crossesMidnight?: boolean }).crossesMidnight).toBe(true);
      await engHr
        .post('/api/v1/shifts', {
          institutionId: com,
          code: 'GEN',
          name: 'Nope',
          startMinute: 540,
          endMinute: 1020,
        })
        .expect(403);

      await engHr
        .post('/api/v1/shifts/assignments', {
          employeeId: N.id,
          shiftId: night.id,
          effectiveFrom: '2025-03-01',
        })
        .expect(201);
      await engHr
        .post('/api/v1/shifts/assignments', {
          departmentId: engCom,
          shiftId: night.id,
          effectiveFrom: '2025-03-01',
        })
        .expect(201);
      await engHr
        .post('/api/v1/shifts/assignments', {
          employeeId: R.id,
          shiftId: gen.id,
          rotationShiftIds: [gen.id, night.id],
          rotationDays: 7,
          effectiveFrom: '2025-03-03',
        })
        .expect(201);

      const resolve = async (employeeId: string, date: string) =>
        (
          await engHr
            .get(`/api/v1/shifts/resolve?employeeId=${employeeId}&date=${date}`)
            .expect(200)
        ).body.data;
      expect(await resolve(N.id, '2025-03-10')).toMatchObject({
        source: 'EMPLOYEE',
        shift: { code: 'NGT' },
      });
      expect(await resolve(N.id, '2025-02-27')).toMatchObject({
        source: 'INSTITUTION_DEFAULT',
        shift: { code: 'GEN' },
      });
      expect(await resolve(D.id, '2025-03-10')).toMatchObject({
        source: 'DEPARTMENT',
        shift: { code: 'NGT' },
      });
      expect((await resolve(R.id, '2025-03-09')).shift.code).toBe('GEN');
      expect((await resolve(R.id, '2025-03-10')).shift.code).toBe('NGT');
      expect((await resolve(R.id, '2025-03-17')).shift.code).toBe('GEN');
      expect(await resolve(A.id, '2025-03-10')).toMatchObject({
        source: 'INSTITUTION_DEFAULT',
        shift: { code: 'GEN' },
      });
    });
  });

  describe('attendance computation', () => {
    it('imports biometric punches and derives daily status', async () => {
      await engHr
        .put(`/api/v1/attendance/policies/${eng}`, {
          timezone: 'Asia/Kolkata',
          lateMarksPerHalfDay: 2,
          absentIsLop: true,
        })
        .expect(200);
      const c = A.employeeCode;
      const res = (
        await engHr
          .post('/api/v1/attendance/punches/import', {
            source: 'BIOMETRIC',
            punches: [
              punch(c, '2025-03-03T09:15:00+05:30', 'IN'),
              punch(c, '2025-03-03T17:15:00+05:30', 'OUT'),
              punch(c, '2025-03-04T09:30:00+05:30', 'IN'),
              punch(c, '2025-03-04T17:30:00+05:30', 'OUT'),
              punch(c, '2025-03-06T09:00:00+05:30', 'IN'),
              punch(c, '2025-03-06T13:30:00+05:30', 'OUT'),
              punch(c, '2025-03-10T09:00:00+05:30', 'IN'),
              punch(c, '2025-03-10T17:00:00+05:30', 'OUT'),
              punch(c, '2025-03-10T17:00:00+05:30', 'OUT'), // duplicate
              punch(N.employeeCode, '2025-03-10T22:00:00+05:30', 'IN'),
              punch(N.employeeCode, '2025-03-11T06:00:00+05:30', 'OUT'),
              punch('NO-SUCH-CODE', '2025-03-10T09:00:00+05:30'),
            ],
          })
          .expect(201)
      ).body.data;
      expect(res).toMatchObject({
        totalRows: 12,
        importedRows: 10,
        duplicateRows: 1,
        failedRows: 1,
      });
      // Imports recompute punched days; days without punches are derived by recomputation.
      for (const employeeId of [A.id, N.id]) {
        await engHr
          .post('/api/v1/attendance/recompute', {
            from: '2025-03-03',
            to: '2025-03-12',
            employeeId,
          })
          .expect(200);
      }

      const a = await records(A.id, '2025-03-03', '2025-03-12');
      expect(a['2025-03-03']).toMatchObject({ status: 'LATE', isLate: true, lateMinutes: 15 });
      expect(a['2025-03-04']).toMatchObject({ status: 'LATE' });
      expect(a['2025-03-05']).toMatchObject({ status: 'HOLIDAY' });
      expect(a['2025-03-06']).toMatchObject({ status: 'HALF_DAY', presentDays: 0.5 });
      expect(a['2025-03-07']).toMatchObject({ status: 'ABSENT', absentDays: 1 });
      expect(a['2025-03-08']).toMatchObject({ status: 'WEEKLY_OFF' });
      expect(a['2025-03-10']).toMatchObject({ status: 'PRESENT', workedMinutes: 450 });

      // Night shift: the 06:00 punch belongs to the 10th.
      const n = await records(N.id, '2025-03-10', '2025-03-11');
      expect(n['2025-03-10']).toMatchObject({ status: 'PRESENT', workedMinutes: 450 });
      expect(n['2025-03-11']).toMatchObject({ status: 'ABSENT' });
      const punches = (
        await engHr
          .get(`/api/v1/attendance/employees/${N.id}/punches?from=2025-03-10&to=2025-03-11`)
          .expect(200)
      ).body.data as { attendanceDate: string }[];
      expect(punches.map((p) => p.attendanceDate)).toEqual(['2025-03-10', '2025-03-10']);
    });

    it('accepts a biometric CSV upload', async () => {
      const csv = `employeeCode,punchedAt,direction,deviceId\n${N.employeeCode},2025-03-12T22:00:00+05:30,IN,DEV-1\n`;
      const { accessToken } = await login(app, 'eng.hr@abbs.test', DEMO_PASSWORD);
      const res = (
        await supertest(app)
          .post('/api/v1/attendance/punches/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', Buffer.from(csv), { filename: 'device.csv', contentType: 'text/csv' })
          .expect(201)
      ).body.data;
      expect(res).toMatchObject({ source: 'BIOMETRIC', importedRows: 1, fileName: 'device.csv' });
    });

    it('lets employees punch and view their own attendance only', async () => {
      const p = (await self.post('/api/v1/attendance/me/punch', { source: 'MOBILE' }).expect(201))
        .body.data;
      expect(p.punch).toMatchObject({ employeeId: A.id, source: 'MOBILE' });
      const mine = (
        await self.get('/api/v1/attendance/me?from=2025-03-01&to=2025-03-10').expect(200)
      ).body.data;
      expect(mine.employeeId).toBe(A.id);
      expect(mine.records.length).toBeGreaterThan(0);
      await self.get(`/api/v1/attendance/records?from=2025-03-01&to=2025-03-10`).expect(403);
      await self
        .get(`/api/v1/attendance/summary?employeeId=${B.id}&from=2025-03-01&to=2025-03-10`)
        .expect((r) => expect([403, 404]).toContain(r.status));
    });

    it('requires a selfie matching the profile photo when the policy says so', async () => {
      const { accessToken } = await login(app, SELF, DEMO_PASSWORD);
      const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      const face = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 10);
      const near = face.map((v) => v + 0.01);
      const far = face.map((v, i) => v + (i % 2 ? 0.2 : -0.2));
      type Challenge = { challenge: string; steps: string[]; expiresAt: string };
      const newChallenge = async (): Promise<Challenge> =>
        (await self.post('/api/v1/attendance/me/liveness-challenge', {}).expect(201)).body.data;
      const proof = (c: Challenge, descriptor: number[]) => ({
        challenge: c.challenge,
        frames: c.steps.map((step) => ({ step, descriptor })),
      });
      // Wrapped: awaiting a supertest request directly would send it.
      const selfiePunch = async (descriptor: number[], liveDescriptor = descriptor) => ({
        req: self.post('/api/v1/attendance/me/punch', {
          source: 'WEB',
          faceDescriptor: descriptor,
          liveness: proof(await newChallenge(), liveDescriptor),
        }),
      });
      // Older clients sent the image as multipart; it must be discarded, never stored.
      const legacySelfiePunch = async (descriptor: number[]) => ({
        req: supertest(app)
          .post('/api/v1/attendance/me/punch')
          .set('Authorization', `Bearer ${accessToken}`)
          .field('source', 'WEB')
          .field('faceDescriptor', JSON.stringify(descriptor))
          .field('liveness', JSON.stringify(proof(await newChallenge(), descriptor)))
          .attach('file', PNG, { filename: 'selfie.png', contentType: 'image/png' }),
      });

      const before = (await engHr.get(`/api/v1/attendance/policies/${eng}`).expect(200)).body.data;
      const policyBody = (requireFaceMatch: boolean) => ({
        timezone: before.timezone,
        lateMarksPerHalfDay: before.lateMarksPerHalfDay,
        absentIsLop: before.absentIsLop,
        allowWebPunch: before.allowWebPunch,
        allowMobilePunch: before.allowMobilePunch,
        requireFaceMatch,
      });
      await owner.put(`/api/v1/attendance/policies/${eng}`, policyBody(true)).expect(200);
      try {
        const today = new Date().toISOString().slice(0, 10);
        expect(
          (await self.get(`/api/v1/attendance/me?from=${today}&to=${today}`).expect(200)).body.data
            .faceMatchRequired,
        ).toBe(true);
        // No registered face yet.
        await (await selfiePunch(face)).req.expect(409, /PROFILE_PHOTO_REQUIRED/);

        await supertest(app)
          .post('/api/v1/employees/me/photo')
          .set('Authorization', `Bearer ${accessToken}`)
          .field('faceDescriptor', JSON.stringify(face))
          .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
          .expect(201);
        const stored = (await self.get('/api/v1/employees/me/face').expect(200)).body.data;
        expect(stored.hasPhoto).toBe(true);
        expect(stored.descriptor).toHaveLength(128);
        expect(
          (await self.get('/api/v1/employees/me/photo-url').expect(200)).body.data.url,
        ).toBeTruthy();

        await self
          .post('/api/v1/attendance/me/punch', { source: 'WEB' })
          .expect(400, /SELFIE_REQUIRED/);
        await (await selfiePunch(far)).req.expect(422, /FACE_MISMATCH/);

        // Liveness: required, signed for this employee, steps in the issued order, unexpired,
        // and every step must show the enrolled face.
        await self
          .post('/api/v1/attendance/me/punch', { source: 'WEB', faceDescriptor: near })
          .expect(400, /LIVENESS_REQUIRED/);
        const c = await newChallenge();
        expect(c.steps).toHaveLength(2);
        expect(c.steps).toContain('BLINK');
        expect(c.steps.some((x) => x === 'TURN_LEFT' || x === 'TURN_RIGHT')).toBe(true);
        expect(Date.parse(c.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000);
        const punchWith = (liveness: unknown) =>
          self.post('/api/v1/attendance/me/punch', {
            source: 'WEB',
            faceDescriptor: near,
            liveness,
          });
        const [body, mac] = c.challenge.split('.');
        const forged = JSON.parse(Buffer.from(body!, 'base64url').toString());
        forged.x = Date.now() + 3_600_000;
        await punchWith({
          ...proof(c, near),
          challenge: `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`,
        }).expect(422, /LIVENESS_FAILED/);
        await punchWith({
          challenge: c.challenge,
          frames: [...c.steps].reverse().map((step) => ({ step, descriptor: near })),
        }).expect(422, /LIVENESS_FAILED/);
        await punchWith({
          challenge: c.challenge,
          frames: [{ step: c.steps[0], descriptor: near }],
        }).expect(422, /LIVENESS_FAILED/);
        await (await selfiePunch(near, far)).req.expect(422, /FACE_MISMATCH/);
        const managerChallenge = (
          await supertest(app)
            .post('/api/v1/attendance/me/liveness-challenge')
            .set(
              'Authorization',
              `Bearer ${(await login(app, MANAGER, DEMO_PASSWORD)).accessToken}`,
            )
            .expect(201)
        ).body.data;
        await punchWith(proof(managerChallenge, near)).expect(422, /someone else/);

        const ok = (await (await selfiePunch(near)).req.expect(201)).body.data.punch;
        expect(ok.selfieDocumentId).toBeNull();
        expect(Number(ok.faceDistance)).toBeLessThan(0.5);
        const legacy = (await (await legacySelfiePunch(near)).req.expect(201)).body.data.punch;
        expect(legacy.selfieDocumentId).toBeNull();
      } finally {
        await owner.put(`/api/v1/attendance/policies/${eng}`, policyBody(false)).expect(200);
      }
    });
  });

  describe('leave', () => {
    it('configures types and policies (org-level only)', async () => {
      await engHr.post('/api/v1/leave/types', { code: 'XX', name: 'Nope' }).expect(403);
      cl = (
        await owner
          .post('/api/v1/leave/types', { code: 'CL', name: 'Casual leave', maxCarryForward: 0 })
          .expect(201)
      ).body.data;
      el = (
        await owner
          .post('/api/v1/leave/types', {
            code: 'EL',
            name: 'Earned leave',
            sandwichRule: true,
            encashable: true,
            maxEncashDays: 3,
            maxCarryForward: 5,
          })
          .expect(201)
      ).body.data;
      lwp = (
        await owner
          .post('/api/v1/leave/types', { code: 'LWP', name: 'Leave without pay', isPaid: false })
          .expect(201)
      ).body.data;
      await owner
        .post('/api/v1/leave/policies', {
          name: 'Default',
          rules: [
            { leaveTypeId: cl.id, accrualFrequency: 'MONTHLY', annualQuota: 12 },
            { leaveTypeId: el.id, accrualFrequency: 'YEARLY', annualQuota: 18 },
          ],
        })
        .expect(201);
    });

    it('accrues per period with joining pro-rata (idempotently)', async () => {
      await owner.post('/api/v1/leave/accrual/run', { asOf: '2025-03-31' }).expect(200);
      await owner.post('/api/v1/leave/accrual/run', { asOf: '2025-03-31' }).expect(200);
      expect((await balanceOf(A.id, cl.id, '2025-03-31'))?.balance).toBe(3);
      expect((await balanceOf(A.id, el.id, '2025-03-31'))?.balance).toBe(18);
      expect((await balanceOf(J.id, cl.id, '2025-03-31'))?.balance).toBe(2.5);
      expect((await balanceOf(J.id, el.id, '2025-03-31'))?.balance).toBe(17.25);
    });

    it('calculates leave days with holidays, weekly offs, halves and the sandwich rule', async () => {
      const preview = async (leaveTypeId: string, extra: Record<string, unknown> = {}) =>
        (
          await self
            .post('/api/v1/leave/preview', {
              leaveTypeId,
              fromDate: '2025-03-13',
              toDate: '2025-03-17',
              ...extra,
            })
            .expect(200)
        ).body.data;
      // 13 Thu, 14 Holi, 15 3rd Sat (working), 16 Sun, 17 Mon.
      expect((await preview(cl.id)).days).toBe(3);
      const sandwich = await preview(el.id);
      expect(sandwich.days).toBe(5);
      expect(sandwich.breakdown.filter((d: { sandwiched: boolean }) => d.sandwiched)).toHaveLength(
        2,
      );
      expect((await preview(cl.id, { toDate: '2025-03-13', startHalf: true })).days).toBe(0.5);
      expect((await preview(cl.id, { startHalf: true, endHalf: true })).days).toBe(2);
    });

    it('routes leave through the reporting manager and consumes the balance', async () => {
      const def = (
        await owner
          .post('/api/v1/workflows/definitions', {
            entityType: 'leave_request',
            name: 'Leave approval',
            steps: [
              {
                key: 'manager',
                name: 'Reporting manager',
                approvers: [{ type: 'reporting_manager', levels: 1 }],
              },
            ],
          })
          .expect(201)
      ).body.data;
      try {
        const req = (
          await self
            .post('/api/v1/leave/me/requests', {
              leaveTypeId: cl.id,
              fromDate: '2025-03-07',
              toDate: '2025-03-07',
              reason: 'Personal work',
            })
            .expect(201)
        ).body.data;
        expect(req).toMatchObject({ status: 'PENDING_APPROVAL', days: 1 });
        expect((await balanceOf(A.id, cl.id, '2025-03-31'))?.pending).toBe(1);
        // Overlap and insufficient balance are refused.
        await self
          .post('/api/v1/leave/me/requests', {
            leaveTypeId: el.id,
            fromDate: '2025-03-07',
            toDate: '2025-03-07',
            reason: 'Overlap',
          })
          .expect(409);
        const insufficient = await self
          .post('/api/v1/leave/me/requests', {
            leaveTypeId: cl.id,
            fromDate: '2025-03-17',
            toDate: '2025-03-21',
            reason: 'Too long',
          })
          .expect(422);
        expect(insufficient.body.error.code).toBe('INSUFFICIENT_LEAVE_BALANCE');

        const notes = await prisma.notification.findMany({
          where: { userId: userIds[MANAGER]!, eventKey: 'leave.applied' },
        });
        expect(notes.length).toBeGreaterThan(0);
        const inbox = (await manager.get('/api/v1/workflows/inbox').expect(200)).body.data;
        expect(inbox.map((i: { id: string }) => i.id)).toContain(req.workflowInstanceId);
        await manager
          .post(`/api/v1/workflows/instances/${req.workflowInstanceId}/actions`, {
            action: 'approve',
          })
          .expect(200);
        await drainJobs();
        const approved = (await self.get('/api/v1/leave/me/requests').expect(200)).body.data.find(
          (r: { id: string }) => r.id === req.id,
        );
        expect(approved.status).toBe('APPROVED');
        expect(await balanceOf(A.id, cl.id, '2025-03-31')).toMatchObject({
          balance: 2,
          pending: 0,
        });
        expect((await records(A.id, '2025-03-07', '2025-03-07'))['2025-03-07']).toMatchObject({
          status: 'ON_LEAVE',
          paidLeaveDays: 1,
        });
        // Started leave cannot be withdrawn by the employee.
        await self
          .post(`/api/v1/leave/requests/${req.id}/cancel`, { reason: 'Changed my mind' })
          .expect(409);
      } finally {
        await archive(def.id);
      }
    });

    it('reverses the balance when HR cancels approved leave', async () => {
      const req = (
        await engHr
          .post('/api/v1/leave/requests', {
            employeeId: A.id,
            leaveTypeId: el.id,
            fromDate: '2025-03-17',
            toDate: '2025-03-18',
            reason: 'Family function',
          })
          .expect(201)
      ).body.data;
      expect(req).toMatchObject({ status: 'APPROVED', days: 2 });
      expect((await balanceOf(A.id, el.id, '2025-03-31'))?.balance).toBe(16);
      expect((await records(A.id, '2025-03-17', '2025-03-17'))['2025-03-17']?.status).toBe(
        'ON_LEAVE',
      );
      await engHr
        .post(`/api/v1/leave/requests/${req.id}/cancel`, { reason: 'Event cancelled' })
        .expect(200);
      expect((await balanceOf(A.id, el.id, '2025-03-31'))?.balance).toBe(18);
      expect((await records(A.id, '2025-03-17', '2025-03-17'))['2025-03-17']?.status).toBe(
        'ABSENT',
      );
      const ledger = (
        await engHr.get(`/api/v1/leave/ledger?employeeId=${A.id}&leaveTypeId=${el.id}`).expect(200)
      ).body.data as { entryType: string; days: number }[];
      expect(ledger.map((e) => [e.entryType, e.days]).sort()).toEqual(
        [
          ['ACCRUAL', 18],
          ['CONSUMPTION', -2],
          ['REVERSAL', 2],
        ].sort(),
      );
    });

    it('records unpaid leave as LOP without touching balances', async () => {
      const req = (
        await engHr
          .post('/api/v1/leave/requests', {
            employeeId: A.id,
            leaveTypeId: lwp.id,
            fromDate: '2025-03-11',
            toDate: '2025-03-11',
            reason: 'Unpaid day',
          })
          .expect(201)
      ).body.data;
      expect(req.status).toBe('APPROVED');
      expect((await records(A.id, '2025-03-11', '2025-03-11'))['2025-03-11']).toMatchObject({
        status: 'LOP',
        unpaidLeaveDays: 1,
      });
    });

    it('enforces scope and tenant isolation', async () => {
      await engHr
        .post('/api/v1/leave/requests', {
          employeeId: B.id,
          leaveTypeId: cl.id,
          fromDate: '2025-03-12',
          toDate: '2025-03-12',
          reason: 'Out of scope',
        })
        .expect((r) => expect([403, 404]).toContain(r.status));
      await engHr
        .get(`/api/v1/leave/balances?employeeId=${B.id}`)
        .expect((r) => expect([403, 404]).toContain(r.status));
      const engList = (
        await engHr.get(`/api/v1/attendance/records?from=2025-03-01&to=2025-03-31&pageSize=100`)
      ).body.data as { employeeId: string }[];
      expect(engList.some((r) => r.employeeId === B.id)).toBe(false);

      const bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
      const types = (await bcc.get('/api/v1/leave/types').expect(200)).body.data;
      expect(types.map((t: { id: string }) => t.id)).not.toContain(cl.id);
      await bcc.get(`/api/v1/leave/balances?employeeId=${A.id}`).expect(404);
      const bccRecords = (
        await bcc
          .get(`/api/v1/attendance/records?employeeId=${A.id}&from=2025-03-01&to=2025-03-31`)
          .expect(200)
      ).body.data;
      expect(bccRecords).toEqual([]);
      const cals = (await bcc.get('/api/v1/holidays/calendars').expect(200)).body.data;
      expect(cals).toEqual([]);
    });

    it('applies group / institution policy rules and lets HR override them (audited)', async () => {
      const rule = (extra: Record<string, unknown>) => ({
        leaveTypeId: cl.id,
        accrualFrequency: 'MONTHLY',
        annualQuota: 12,
        ...extra,
      });
      await owner
        .post('/api/v1/leave/policies', {
          name: 'Both scopes',
          groupId,
          institutionId: eng,
          rules: [],
        })
        .expect(400);
      const badGroup = await owner
        .post('/api/v1/leave/policies', {
          name: 'Bad group',
          groupId: '00000000-0000-4000-8000-000000000000',
          rules: [],
        })
        .expect(422);
      expect(badGroup.body.error.details).toMatchObject({ field: 'groupId' });

      const groupPolicy = (
        await owner
          .post('/api/v1/leave/policies', {
            name: 'Group rules',
            groupId,
            rules: [rule({ allowBackdated: false, maxConsecutiveDays: 2, sandwichMode: 'NONE' })],
          })
          .expect(201)
      ).body.data;
      expect(groupPolicy.groupId).toBe(groupId);
      let instPolicy: { id: string } | null = null;
      try {
        const preview = async () =>
          (
            await self
              .post('/api/v1/leave/preview', {
                leaveTypeId: cl.id,
                fromDate: '2025-03-12',
                toDate: '2025-03-12',
              })
              .expect(200)
          ).body.data;
        const p1 = await preview();
        expect(p1.rules).toMatchObject({ policyName: 'Group rules', allowBackdated: false });
        expect(p1.violations.map((v: { code: string }) => v.code)).toEqual([
          'LEAVE_BACKDATED_NOT_ALLOWED',
        ]);
        expect(p1.rules.hints).toContain('Past-dated requests are not allowed');

        const blocked = await owner
          .post('/api/v1/leave/requests', {
            employeeId: A.id,
            leaveTypeId: cl.id,
            fromDate: '2025-03-12',
            toDate: '2025-03-12',
            reason: 'Backdated',
          })
          .expect(422);
        expect(blocked.body.error.code).toBe('LEAVE_BACKDATED_NOT_ALLOWED');

        const overridden = (
          await owner
            .post('/api/v1/leave/requests', {
              employeeId: A.id,
              leaveTypeId: cl.id,
              fromDate: '2025-03-12',
              toDate: '2025-03-12',
              reason: 'Backdated',
              ruleOverrideReason: 'Forgot to apply, approved by HR',
            })
            .expect(201)
        ).body.data;
        expect(overridden.ruleOverrideReason).toBe('Forgot to apply, approved by HR');
        const audit = await prisma.auditLog.findFirst({
          where: { action: 'leave.rules_override', entityId: overridden.id },
        });
        expect(audit?.reason).toBe('Forgot to apply, approved by HR');
        await owner
          .post(`/api/v1/leave/requests/${overridden.id}/cancel`, { reason: 'Test cleanup' })
          .expect(200);

        // An institution policy is more specific than the group policy.
        instPolicy = (
          await owner
            .post('/api/v1/leave/policies', {
              name: 'Institution rules',
              institutionId: eng,
              rules: [rule({})],
            })
            .expect(201)
        ).body.data;
        const p2 = await preview();
        expect(p2.rules.policyName).toBe('Institution rules');
        expect(p2.violations).toEqual([]);
      } finally {
        for (const id of [groupPolicy.id, instPolicy?.id]) {
          if (id) {
            await owner.patch(`/api/v1/leave/policies/${id}`, { status: 'INACTIVE' }).expect(200);
          }
        }
      }
    });
  });

  describe('regularization', () => {
    it('applies directly without a workflow, and via the reporting manager with one', async () => {
      const direct = (
        await self
          .post('/api/v1/attendance/me/regularizations', {
            date: '2025-03-12',
            requestedStatus: 'ON_DUTY',
            reason: 'Exam duty at another campus',
          })
          .expect(201)
      ).body.data;
      expect(direct.status).toBe('APPROVED');
      expect((await records(A.id, '2025-03-12', '2025-03-12'))['2025-03-12']).toMatchObject({
        status: 'ON_DUTY',
        presentDays: 1,
      });

      const def = (
        await owner
          .post('/api/v1/workflows/definitions', {
            entityType: 'attendance_regularization',
            name: 'Regularization',
            steps: [
              {
                key: 'manager',
                name: 'Reporting manager',
                approvers: [{ type: 'reporting_manager', levels: 1 }],
              },
            ],
          })
          .expect(201)
      ).body.data;
      try {
        const reg = (
          await self
            .post('/api/v1/attendance/me/regularizations', {
              date: '2025-03-13',
              inMinute: 540,
              outMinute: 1020,
              reason: 'Forgot to punch',
            })
            .expect(201)
        ).body.data;
        expect(reg.status).toBe('PENDING_APPROVAL');
        await engHr
          .post('/api/v1/attendance/recompute', {
            from: '2025-03-13',
            to: '2025-03-13',
            employeeId: A.id,
          })
          .expect(200);
        expect((await records(A.id, '2025-03-13', '2025-03-13'))['2025-03-13']?.status).toBe(
          'ABSENT',
        );
        await self
          .post('/api/v1/attendance/me/regularizations', {
            date: '2025-03-13',
            requestedStatus: 'PRESENT',
            reason: 'Again',
          })
          .expect(409);
        await manager
          .post(`/api/v1/workflows/instances/${reg.workflowInstanceId}/actions`, {
            action: 'approve',
          })
          .expect(200);
        await drainJobs();
        expect((await records(A.id, '2025-03-13', '2025-03-13'))['2025-03-13']).toMatchObject({
          status: 'PRESENT',
          workedMinutes: 450,
        });
        const notes = await prisma.notification.findMany({
          where: { userId: userIds[SELF]!, eventKey: 'attendance.regularization_decided' },
        });
        expect(notes.length).toBeGreaterThan(0);
      } finally {
        await archive(def.id);
      }
    });
  });

  describe('payroll feed', () => {
    it('summarizes a period incl. late-mark LOP, paid leave and holidays', async () => {
      // 3 LATE, 4 LATE, 5 HOLIDAY, 6 HALF_DAY, 7 CL, 8/9 weekly off.
      const s = await summary(A.id, '2025-03-03', '2025-03-09');
      expect(s).toMatchObject({
        employeeId: A.id,
        calendarDays: 7,
        employedDays: 7,
        pendingDays: 0,
        presentDays: 2.5,
        absentDays: 0.5,
        paidLeaveDays: 1,
        paidLeaveByType: [{ leaveTypeId: cl.id, code: 'CL', days: 1 }],
        unpaidLeaveDays: 0,
        holidays: 1,
        weeklyOffs: 2,
        lateCount: 2,
        lateDeductionDays: 0.5,
        lopDays: 1,
        payableDays: 6,
        locked: false,
      });
      // 10 PRESENT, 11 LWP, 12 ON_DUTY (regularized), 13 PRESENT (regularized).
      const s2 = await summary(A.id, '2025-03-10', '2025-03-13');
      expect(s2).toMatchObject({
        presentDays: 3,
        onDutyDays: 1,
        unpaidLeaveDays: 1,
        absentDays: 0,
        lopDays: 1,
        payableDays: 3,
      });
    });

    it('splits a transferred employee by institution with each calendar', async () => {
      const s = await runAsSystem(abbs, () =>
        attendanceSummaryForPeriod(T.id, '2025-03-10', '2025-03-23'),
      );
      expect(s[0]).toMatchObject({
        employedDays: 14,
        holidays: 2, // 14 Holi (ENG), 20 Commerce Day (COM)
        weeklyOffs: 3, // 16, 22, 23
        absentDays: 9,
        institutionDays: expect.arrayContaining([
          { institutionId: eng, days: 6 },
          { institutionId: com, days: 8 },
        ]),
      });
    });

    it('excludes days before joining', async () => {
      const s = await summary(J.id, '2025-01-01', '2025-01-31');
      expect(s).toMatchObject({ calendarDays: 31, employedDays: 16 });
    });
  });

  describe('period lock', () => {
    it('blocks edits in a locked period until explicitly unlocked', async () => {
      const lock = (
        await engHr
          .post('/api/v1/attendance/locks', {
            institutionId: eng,
            periodStart: '2025-03-01',
            periodEnd: '2025-03-31',
            reason: 'March payroll',
          })
          .expect(201)
      ).body.data;
      await engHr
        .post('/api/v1/attendance/locks', {
          institutionId: eng,
          periodStart: '2025-03-15',
          periodEnd: '2025-04-15',
        })
        .expect(409);
      expect((await summary(A.id, '2025-03-03', '2025-03-09')).locked).toBe(true);

      const override = await engHr
        .post('/api/v1/attendance/override', {
          employeeId: A.id,
          date: '2025-03-07',
          status: 'PRESENT',
          reason: 'Correction',
        })
        .expect(409);
      expect(override.body.error.code).toBe('PERIOD_LOCKED');
      await self
        .post('/api/v1/attendance/me/regularizations', {
          date: '2025-03-19',
          requestedStatus: 'PRESENT',
          reason: 'Late request',
        })
        .expect(409);
      await engHr
        .post('/api/v1/leave/requests', {
          employeeId: A.id,
          leaveTypeId: cl.id,
          fromDate: '2025-03-19',
          toDate: '2025-03-19',
          reason: 'Backdated',
        })
        .expect(409);
      const before = (await records(A.id, '2025-03-19', '2025-03-19'))['2025-03-19'];
      const imp = (
        await engHr
          .post('/api/v1/attendance/punches/import', {
            punches: [
              punch(A.employeeCode, '2025-03-19T09:00:00+05:30'),
              punch(A.employeeCode, '2025-03-19T17:00:00+05:30'),
            ],
          })
          .expect(201)
      ).body.data;
      expect(imp.importedRows).toBe(0);
      expect((await records(A.id, '2025-03-19', '2025-03-19'))['2025-03-19']).toEqual(before);

      // Unlock requires attendance.unlock (not part of HR) and is audited.
      await engHr
        .post(`/api/v1/attendance/locks/${lock.id}/unlock`, { reason: 'Correction' })
        .expect(403);
      await owner
        .post(`/api/v1/attendance/locks/${lock.id}/unlock`, { reason: 'Late correction' })
        .expect(200);
      const audits = await prisma.auditLog.findMany({
        where: { organizationId: abbs, action: 'attendance.period_unlock' },
      });
      expect(audits.length).toBeGreaterThan(0);
      await engHr
        .post('/api/v1/attendance/override', {
          employeeId: A.id,
          date: '2025-03-07',
          status: 'PRESENT',
          reason: 'Correction',
        })
        .expect(200);
      await engHr
        .post('/api/v1/attendance/override', {
          employeeId: A.id,
          date: '2025-03-07',
          status: null,
          reason: 'Revert',
        })
        .expect(200);
    });
  });

  describe('year end', () => {
    it('encashes, carries forward and lapses per caps (idempotently)', async () => {
      await owner.post('/api/v1/leave/year-end', { year: 2025 }).expect(200);
      await owner.post('/api/v1/leave/year-end', { year: 2025 }).expect(200);
      // EL 18 -> 3 encashed, 5 carried forward, 10 lapsed. CL 2 -> lapsed (cap 0).
      // Balances are per leave year: the carried 5 closes 2025 and opens 2026.
      expect((await balanceOf(A.id, el.id, '2025-12-31'))?.balance).toBe(5);
      expect((await balanceOf(A.id, el.id, '2026-01-01'))?.balance).toBe(5);
      expect((await balanceOf(A.id, cl.id, '2025-12-31'))?.balance).toBe(0);
      expect((await balanceOf(A.id, cl.id, '2026-01-01'))?.balance ?? 0).toBe(0);
      const ledger = (
        await engHr.get(`/api/v1/leave/ledger?employeeId=${A.id}&leaveTypeId=${el.id}`).expect(200)
      ).body.data as { entryType: string; days: number }[];
      expect(ledger.filter((e) => e.entryType === 'ENCASHMENT').map((e) => e.days)).toEqual([-3]);
      expect(ledger.filter((e) => e.entryType === 'LAPSE').map((e) => e.days)).toEqual([-10]);
      expect(ledger.filter((e) => e.entryType === 'CARRY_FORWARD').map((e) => e.days)).toEqual([5]);
    });
  });
});

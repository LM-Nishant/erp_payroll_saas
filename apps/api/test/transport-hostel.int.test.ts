import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDatabase)('transport & hostel', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  let eng: string;
  let owner: Client;
  let engAdmin: Client;
  let hod: Client;
  let bccAdmin: Client;
  let studentClient: Client;
  let boy: { id: string };
  let girl: { id: string };
  let boy2: { id: string };

  beforeAll(async () => {
    const { orgIds } = await seedAccessFixture();
    eng = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: orgIds.abbs!, code: 'ABBS-ENG' },
      })
    ).id;
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    engAdmin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    hod = await signIn(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);

    const dept = await prisma.department.findFirstOrThrow({
      where: { institutionId: eng, code: 'CSE' },
    });
    const campus = await prisma.campus.findFirstOrThrow({
      where: { institutionId: eng, deletedAt: null },
    });
    const program = (
      await owner
        .post('/api/v1/programs', {
          departmentId: dept.id,
          name: `TH ${suffix}`,
          code: `TH-${suffix}`,
        })
        .expect(201)
    ).body.data;
    const section = (
      await owner
        .post('/api/v1/class-sections', {
          programId: program.id,
          campusId: campus.id,
          name: `TH ${suffix}`,
          code: `T${suffix}`,
          academicYear: '2026-27',
        })
        .expect(201)
    ).body.data;

    const roles = (await owner.get('/api/v1/roles?pageSize=100').expect(200)).body.data;
    const studentRole = roles.find((r: { key: string }) => r.key === 'student');
    const email = `th.student.${suffix.toLowerCase()}@abbs.test`;
    const user = (
      await owner
        .post('/api/v1/users', {
          email,
          name: 'Hostel Boy',
          password: 'Stud-Passw0rd!',
          roles: [{ roleId: studentRole.id, scopes: [{ type: 'INSTITUTION', id: eng }] }],
        })
        .expect(201)
    ).body.data;
    const mk = async (firstName: string, gender: string, userId?: string) =>
      (
        await owner
          .post('/api/v1/students', {
            classSectionId: section.id,
            academicYear: '2026-27',
            firstName,
            lastName: suffix,
            gender,
            ...(userId && { userId }),
          })
          .expect(201)
      ).body.data;
    boy = await mk('Arjun', 'MALE', user.id);
    girl = await mk('Meera', 'FEMALE');
    boy2 = await mk('Kabir', 'MALE');
    studentClient = await signIn(app, email, 'Stud-Passw0rd!');
  });
  afterAll(() => prisma.$disconnect());

  it('runs the transport flow: vehicle → route with stops → allocation with seat check', async () => {
    const vehicle = (
      await engAdmin
        .post('/api/v1/transport/vehicles', {
          institutionId: eng,
          regNo: `ka 01 th ${suffix}`,
          capacity: 1,
          insuranceExpiry: isoDay(10),
        })
        .expect(201)
    ).body.data;
    expect(vehicle.regNo).toBe(`KA 01 TH ${suffix}`);
    await engAdmin
      .post('/api/v1/transport/fare-slabs', {
        institutionId: eng,
        name: `0-10 ${suffix}`,
        minKm: 0,
        maxKm: 10,
        amount: 1500,
      })
      .expect(201);
    const route = (
      await engAdmin
        .post('/api/v1/transport/routes', {
          institutionId: eng,
          code: `R${suffix}`,
          name: 'North loop',
          vehicleId: vehicle.id,
          stops: [
            { name: 'Market', sequence: 1, pickupTime: '07:10', dropTime: '16:40', distanceKm: 4 },
            { name: 'Lake', sequence: 2, pickupTime: '07:25', dropTime: '16:25', fareAmount: 900 },
          ],
        })
        .expect(201)
    ).body.data;
    const full = (await engAdmin.get(`/api/v1/transport/routes/${route.id}`).expect(200)).body.data;
    const [market] = full.stops;
    const alloc = (
      await engAdmin
        .post('/api/v1/transport/allocations', {
          studentId: boy.id,
          routeId: route.id,
          stopId: market.id,
          effectiveFrom: isoDay(0),
        })
        .expect(201)
    ).body.data;
    expect(alloc.fareAmount).toBe(1500);
    const over = await engAdmin
      .post('/api/v1/transport/allocations', {
        studentId: girl.id,
        routeId: route.id,
        stopId: market.id,
        effectiveFrom: isoDay(0),
      })
      .expect(409);
    expect(over.body.error.code).toBe('CAPACITY_EXCEEDED');

    const mine = (await studentClient.get('/api/v1/transport/me').expect(200)).body.data;
    expect(mine[0].route.code).toBe(`R${suffix}`);
    expect(mine[0].vehicle.regNo).toBe(vehicle.regNo);

    const charges = (
      await engAdmin
        .post('/api/v1/transport/charges/generate', {
          period: isoDay(0).slice(0, 7),
          institutionId: eng,
        })
        .expect(200)
    ).body.data;
    expect(charges.created).toBeGreaterThanOrEqual(1);
    // The fees module posts student transport charges as TRANSPORT fee invoices.
    expect(charges.posted).toBe(charges.created);
    const tc = await prisma.transportCharge.findFirstOrThrow({
      where: { studentId: boy.id, period: isoDay(0).slice(0, 7) },
    });
    expect(tc.status).toBe('POSTED');
    const invoice = await prisma.feeInvoice.findFirstOrThrow({
      where: { id: tc.externalRef! },
      include: { lines: { include: { feeHead: true } } },
    });
    expect(invoice).toMatchObject({
      studentId: boy.id,
      sourceType: 'TRANSPORT_CHARGE',
      sourceId: tc.id,
    });
    expect(invoice.lines[0]?.feeHead.code).toBe('TRANSPORT');
    // Waiving the charge cancels the unpaid fee invoice.
    await engAdmin.patch(`/api/v1/transport/charges/${tc.id}`, { status: 'WAIVED' }).expect(200);
    expect((await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      'CANCELLED',
    );

    // Scope & tenant isolation
    await hod.get('/api/v1/transport/vehicles').expect(403);
    await bccAdmin.get(`/api/v1/transport/vehicles/${vehicle.id}`).expect(404);
    const bccList = (await bccAdmin.get('/api/v1/transport/vehicles?pageSize=100').expect(200))
      .body;
    expect(bccList.data.some((v: { id: string }) => v.id === vehicle.id)).toBe(false);
    await studentClient.get('/api/v1/transport/vehicles').expect(403);
  });

  it('runs the hostel flow: rooms/beds → allocation → out-pass approval → roll call', async () => {
    const hostel = (
      await engAdmin
        .post('/api/v1/hostel', {
          institutionId: eng,
          code: `bh${suffix}`,
          name: 'Boys Hostel',
          hostelType: 'BOYS',
        })
        .expect(201)
    ).body.data;
    const room = (
      await engAdmin
        .post(`/api/v1/hostel/${hostel.id}/rooms`, {
          roomNo: '101',
          capacity: 2,
          monthlyRent: 3000,
        })
        .expect(201)
    ).body.data;
    expect(room.beds.map((b: { bedNo: string }) => b.bedNo)).toEqual(['A', 'B']);
    const plan = (
      await engAdmin
        .post(`/api/v1/hostel/${hostel.id}/mess-plans`, { name: 'Veg', monthlyFee: 2500 })
        .expect(201)
    ).body.data;

    const alloc = (
      await engAdmin
        .post('/api/v1/hostel/allocations', {
          studentId: boy.id,
          roomId: room.id,
          messPlanId: plan.id,
          fromDate: isoDay(-5),
        })
        .expect(201)
    ).body.data;
    expect(alloc).toMatchObject({ status: 'ACTIVE', monthlyRent: 3000 });
    const mismatch = await engAdmin
      .post('/api/v1/hostel/allocations', {
        studentId: girl.id,
        roomId: room.id,
        fromDate: isoDay(0),
      })
      .expect(422);
    expect(mismatch.body.error.code).toBe('GENDER_MISMATCH');
    await engAdmin
      .post('/api/v1/hostel/allocations', {
        studentId: boy.id,
        roomId: room.id,
        fromDate: isoDay(0),
      })
      .expect(409);
    await engAdmin
      .post('/api/v1/hostel/allocations', {
        studentId: boy2.id,
        roomId: room.id,
        fromDate: isoDay(0),
      })
      .expect(201);
    const fullRoom = await engAdmin
      .post('/api/v1/hostel/allocations', {
        studentId: girl.id,
        roomId: room.id,
        fromDate: isoDay(0),
      })
      .expect((res) => expect([409, 422]).toContain(res.status));
    expect(fullRoom.body.error).toBeTruthy();

    // Portal: my hostel + out-pass apply → warden approves → gate out/in
    const my = (await studentClient.get('/api/v1/hostel/me').expect(200)).body.data;
    expect(my[0].allocation.room.roomNo).toBe('101');
    expect(my[0].roommates).toHaveLength(1);
    const pass = (
      await studentClient
        .post('/api/v1/hostel/me/outpasses', {
          passType: 'HOME',
          fromAt: new Date(Date.now() + 3_600_000).toISOString(),
          toAt: new Date(Date.now() + 86_400_000).toISOString(),
          reason: 'Family function',
        })
        .expect(201)
    ).body.data;
    expect(pass.status).toBe('PENDING');
    await studentClient
      .post(`/api/v1/hostel/outpasses/${pass.id}/decide`, { decision: 'APPROVE' })
      .expect(403);
    const approved = (
      await engAdmin
        .post(`/api/v1/hostel/outpasses/${pass.id}/decide`, { decision: 'APPROVE', comment: 'OK' })
        .expect(200)
    ).body.data;
    expect(approved.status).toBe('APPROVED');
    expect(
      (await engAdmin.post(`/api/v1/hostel/outpasses/${pass.id}/checkout`, {}).expect(200)).body
        .data.status,
    ).toBe('OUT');
    const sheet = (
      await engAdmin
        .get(`/api/v1/hostel/roll-call?hostelId=${hostel.id}&date=${isoDay(0)}`)
        .expect(200)
    ).body.data;
    expect(sheet.entries).toHaveLength(2);
    expect(sheet.entries.find((e: { studentId: string }) => e.studentId === boy.id).onOutpass).toBe(
      true,
    );
    await engAdmin.post(`/api/v1/hostel/outpasses/${pass.id}/return`, {}).expect(200);
    const movements = (
      await engAdmin.get(`/api/v1/hostel/movements?studentId=${boy.id}`).expect(200)
    ).body.data;
    expect(movements.map((m: { direction: string }) => m.direction).sort()).toEqual(['IN', 'OUT']);

    const complaint = (
      await studentClient
        .post('/api/v1/hostel/me/complaints', { title: 'Fan not working', category: 'ELECTRICAL' })
        .expect(201)
    ).body.data;
    expect(complaint.roomNo).toBe('101');
    await engAdmin
      .patch(`/api/v1/hostel/complaints/${complaint.id}`, { status: 'RESOLVED' })
      .expect(200);

    const dash = (await engAdmin.get(`/api/v1/hostel/dashboard?institutionId=${eng}`).expect(200))
      .body.data;
    expect(dash.occupied).toBeGreaterThanOrEqual(2);

    // Vacate frees the bed
    await engAdmin
      .post(`/api/v1/hostel/allocations/${alloc.id}/vacate`, { toDate: isoDay(0) })
      .expect(200);
    const after = (await engAdmin.get(`/api/v1/hostel/rooms/${room.id}`).expect(200)).body.data;
    expect(after.occupied).toBe(1);

    // Scope & tenant isolation
    await hod.get('/api/v1/hostel').expect(403);
    await bccAdmin.get(`/api/v1/hostel/${hostel.id}`).expect(404);
    await bccAdmin.get(`/api/v1/hostel/outpasses/${pass.id}`).expect(404);
    const bccHostels = (await bccAdmin.get('/api/v1/hostel?pageSize=100').expect(200)).body.data;
    expect(bccHostels.some((h: { id: string }) => h.id === hostel.id)).toBe(false);
  });
});

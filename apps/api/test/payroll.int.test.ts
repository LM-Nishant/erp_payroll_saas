import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { drainJobs } from '../src/core/queue';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

/*
 * Layer 8: payroll rule engine, runs, payslips. Scenarios use ABBS-ART / ABBS-MGT in April and
 * May 2025 so they never collide with the attendance suite (ABBS-ENG / COM, March 2025).
 */

const PM = 'l8.pm.art@abbs.test';
const FIN = 'l8.fin.art@abbs.test';
const GFIN = 'l8.gfin@abbs.test';
const EMP1 = 'l8.emp1@abbs.test';
const EMP2 = 'l8.emp2@abbs.test';

type Client = Awaited<ReturnType<typeof signIn>>;
type Emp = { id: string; employeeCode: string };
type Line = { code: string; amount: number; fullAmount: number; explanation: string };
type RunEmp = {
  employeeId: string;
  status: string;
  calendarDays: number;
  payableDays: number;
  lopDays: number;
  institutionDays: number;
  factor: number;
  gross: number;
  deductions: number;
  net: number;
  lines: Line[];
  trace: unknown[];
};

describe.skipIf(!hasTestDatabase)('Payroll rule engine, runs and payslips', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let userIds: Record<string, string>;
  let art: string;
  let mgt: string;
  let groupId: string;
  let artCse: string;
  let mgtCom: string;
  let owner: Client;
  let pm: Client;
  let fin: Client;
  let gfin: Client;
  let emp1: Client;
  let emp2: Client;
  let bcc: Client;
  let seq = 0;

  let E1: Emp; // ART, self-service user EMP1
  let E2: Emp; // ART, self-service user EMP2 (ESI covered, loan)
  let E3: Emp; // MGT, LOP days
  let T: Emp; // ART -> MGT on 2025-04-16

  let artStructure: { id: string };
  let mgtStructure: { id: string };
  let artApril: { id: string };
  let mgtApril: { id: string };

  const name = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1)}`;
  const createEmployee = async (body: Record<string, unknown>) =>
    (
      await owner
        .post('/api/v1/employees', {
          employmentType: 'TEACHING',
          firstName: name('Pay'),
          lastName: 'Test',
          status: 'ACTIVE',
          dateOfJoining: '2024-01-01',
          ...body,
        })
        .expect(201)
    ).body.data as Emp;

  const days = (month: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const punchesFor = (code: string, dates: string[]) =>
    dates.flatMap((d) => [
      { employeeCode: code, punchedAt: `${d}T09:00:00+05:30`, direction: 'IN' },
      { employeeCode: code, punchedAt: `${d}T17:30:00+05:30`, direction: 'OUT' },
    ]);
  const summary = async (employeeId: string, from: string, to: string) =>
    (
      await owner
        .get(`/api/v1/attendance/summary?employeeId=${employeeId}&from=${from}&to=${to}`)
        .expect(200)
    ).body.data[0];
  const runEmployee = async (who: Client, runId: string, employeeId: string) =>
    (await who.get(`/api/v1/payroll/runs/${runId}/employees/${employeeId}`).expect(200)).body
      .data as RunEmp;
  const line = (re: RunEmp, code: string) => re.lines.find((l) => l.code === code);
  const compute = async (who: Client, runId: string) => {
    await who.post(`/api/v1/payroll/runs/${runId}/compute`).expect(202);
    await drainJobs();
    const run = (await who.get(`/api/v1/payroll/runs/${runId}`).expect(200)).body.data;
    expect(run.status).toBe('COMPUTED');
    return run;
  };
  const archive = (id: string) =>
    prisma.workflowDefinition.update({ where: { id }, data: { status: 'ARCHIVED' } });

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    const { seedAccessControl } = await import('../prisma/seed-access');
    const institution = (code: string) => ({ type: 'INSTITUTION' as const, institution: code });
    const extra = await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: PM,
          name: 'L8 PM',
          organization: 'abbs',
          role: 'payroll_manager',
          scope: institution('ABBS-ART'),
        },
        {
          email: FIN,
          name: 'L8 Finance',
          organization: 'abbs',
          role: 'finance_manager',
          scope: institution('ABBS-ART'),
        },
        {
          email: GFIN,
          name: 'L8 Group Finance',
          organization: 'abbs',
          role: 'group_finance',
          scope: { type: 'GROUP', group: 'ABBS' },
        },
        {
          email: EMP1,
          name: 'L8 Emp One',
          organization: 'abbs',
          role: 'employee',
          scope: institution('ABBS-ART'),
        },
        {
          email: EMP2,
          name: 'L8 Emp Two',
          organization: 'abbs',
          role: 'employee',
          scope: institution('ABBS-ART'),
        },
      ],
    });
    userIds = { ...fixture.userIds, ...extra };
    const abbs = fixture.orgIds.abbs!;
    const inst = (code: string) =>
      prisma.institution.findFirstOrThrow({ where: { organizationId: abbs, code } });
    const artRow = await inst('ABBS-ART');
    art = artRow.id;
    groupId = artRow.groupId!;
    mgt = (await inst('ABBS-MGT')).id;
    const dept = async (institutionId: string, code: string) =>
      (await prisma.department.findFirstOrThrow({ where: { institutionId, code } })).id;
    artCse = await dept(art, 'CSE');
    mgtCom = await dept(mgt, 'COM');

    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    pm = await signIn(app, PM, DEMO_PASSWORD);
    fin = await signIn(app, FIN, DEMO_PASSWORD);
    gfin = await signIn(app, GFIN, DEMO_PASSWORD);
    emp1 = await signIn(app, EMP1, DEMO_PASSWORD);
    emp2 = await signIn(app, EMP2, DEMO_PASSWORD);
    bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);

    E1 = await createEmployee({ institutionId: art, departmentId: artCse, userId: userIds[EMP1] });
    E2 = await createEmployee({ institutionId: art, departmentId: artCse, userId: userIds[EMP2] });
    E3 = await createEmployee({ institutionId: mgt, departmentId: mgtCom });
    T = await createEmployee({ institutionId: art, departmentId: artCse });
  });

  afterAll(async () => {
    await prisma.workflowDefinition.updateMany({
      where: { entityType: { in: ['salary_revision', 'payroll_run'] }, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
  });

  describe('masters', () => {
    it('seeds default components and rejects unsafe formulas and cycles', async () => {
      await owner.post('/api/v1/payroll/components/seed-defaults', {}).expect(201);
      const list = (await owner.get('/api/v1/payroll/components?pageSize=100').expect(200)).body
        .data as { code: string }[];
      expect(list.map((c) => c.code)).toEqual(
        expect.arrayContaining([
          'BASIC',
          'HRA',
          'SPECIAL',
          'PF_EE',
          'ESI_EE',
          'PT',
          'TDS',
          'PF_ER',
        ]),
      );

      for (const formula of [
        'constructor.constructor("return 1")()',
        'process.exit(1)',
        'BASIC; 1',
      ]) {
        await owner
          .post('/api/v1/payroll/components', {
            institutionId: mgt,
            code: name('BAD').toUpperCase().slice(0, 20),
            name: 'Unsafe',
            type: 'EARNING',
            calcType: 'FORMULA',
            formula,
          })
          .expect((r) => expect([400, 422]).toContain(r.status));
      }

      const a = (
        await owner
          .post('/api/v1/payroll/components', {
            institutionId: mgt,
            code: 'CYA',
            name: 'Cycle A',
            type: 'EARNING',
            calcType: 'FORMULA',
            formula: '100',
          })
          .expect(201)
      ).body.data;
      const b = (
        await owner
          .post('/api/v1/payroll/components', {
            institutionId: mgt,
            code: 'CYB',
            name: 'Cycle B',
            type: 'EARNING',
            calcType: 'FORMULA',
            formula: 'CYA + 1',
          })
          .expect(201)
      ).body.data;
      const cyc = await owner
        .patch(`/api/v1/payroll/components/${a.id}`, { formula: 'CYB * 2' })
        .expect(422);
      expect(cyc.body.error.code).toBe('INVALID_SALARY_GRAPH');
      expect(cyc.body.error.message).toMatch(/Circular/);
      // Deactivate dependants first (deactivating CYA alone would leave CYB dangling).
      await owner.patch(`/api/v1/payroll/components/${a.id}`, { status: 'INACTIVE' }).expect(422);
      await owner.patch(`/api/v1/payroll/components/${b.id}`, { status: 'INACTIVE' }).expect(200);
      await owner.patch(`/api/v1/payroll/components/${a.id}`, { status: 'INACTIVE' }).expect(200);
    });

    it('keeps separate policies per institution (slab, formula, institution rules)', async () => {
      // MGT-only components: slab conveyance and a formula attendance bonus.
      await owner
        .post('/api/v1/payroll/components', {
          institutionId: mgt,
          code: 'CONV',
          name: 'Conveyance',
          type: 'EARNING',
          calcType: 'SLAB',
          slabBasis: 'BASIC',
          slabs: [
            { from: 0, to: 10000, amount: 800 },
            { from: 10000.01, to: null, amount: 1600 },
          ],
          proRated: false,
          displayOrder: 40,
        })
        .expect(201);
      await owner
        .post('/api/v1/payroll/components', {
          institutionId: mgt,
          code: 'ATTB',
          name: 'Attendance bonus',
          type: 'EARNING',
          calcType: 'FORMULA',
          formula: 'if(LOP_DAYS == 0, 500, 0)',
          proRated: false,
          displayOrder: 50,
        })
        .expect(201);
      // MGT pays HRA at 50% of BASIC; ART keeps the organization default (40%).
      await owner
        .post('/api/v1/payroll/rules', {
          institutionId: mgt,
          componentCode: 'HRA',
          effectiveFrom: '2025-01-01',
          calcType: 'PERCENTAGE',
          percentage: 50,
          percentOf: 'BASIC',
        })
        .expect(201);

      artStructure = (
        await pm
          .post('/api/v1/payroll/structures', {
            institutionId: art,
            code: 'ART_STD',
            name: 'ART standard',
            version: {
              effectiveFrom: '2025-01-01',
              lines: [
                { componentCode: 'BASIC' },
                { componentCode: 'HRA' },
                { componentCode: 'SPECIAL' },
              ],
            },
          })
          .expect(201)
      ).body.data;
      // v2 from May: HRA at 50% of BASIC (structure versioning by effective date).
      await pm
        .post(`/api/v1/payroll/structures/${artStructure.id}/versions`, {
          effectiveFrom: '2025-05-01',
          lines: [
            { componentCode: 'BASIC' },
            { componentCode: 'HRA', calcType: 'PERCENTAGE', percentage: 50, percentOf: 'BASIC' },
            { componentCode: 'SPECIAL' },
          ],
        })
        .expect(201);
      mgtStructure = (
        await owner
          .post('/api/v1/payroll/structures', {
            institutionId: mgt,
            code: 'MGT_STD',
            name: 'MGT standard',
            version: {
              effectiveFrom: '2025-01-01',
              lines: [
                { componentCode: 'BASIC' },
                { componentCode: 'HRA' },
                { componentCode: 'SPECIAL' },
                { componentCode: 'CONV' },
                { componentCode: 'ATTB' },
              ],
            },
          })
          .expect(201)
      ).body.data;

      // ART cannot use MGT's structure; the ART payroll manager cannot touch MGT.
      await pm
        .post('/api/v1/payroll/structures', {
          institutionId: mgt,
          code: 'NOPE',
          name: 'Nope',
          version: { effectiveFrom: '2025-01-01', lines: [{ componentCode: 'BASIC' }] },
        })
        .expect((r) => expect([403, 404]).toContain(r.status));

      await owner.put('/api/v1/payroll/settings', { institutionId: art, state: 'KA' }).expect(200);
      await owner.put('/api/v1/payroll/settings', { institutionId: mgt, state: 'MH' }).expect(200);
    });

    it('assigns salaries (linked to the immutable salary history)', async () => {
      const assign = (who: Client, e: Emp, structureId: string, annualCtc: number) =>
        who
          .post(`/api/v1/payroll/employees/${e.id}/salary`, {
            structureId,
            effectiveFrom: '2025-03-01',
            annualCtc,
          })
          .expect(201);
      await assign(pm, E1, artStructure.id, 360000);
      await assign(pm, E2, artStructure.id, 216000);
      await assign(pm, T, artStructure.id, 240000);
      await assign(owner, E3, mgtStructure.id, 300000);
      // A second assignment must go through a revision.
      await pm
        .post(`/api/v1/payroll/employees/${E1.id}/salary`, {
          structureId: artStructure.id,
          effectiveFrom: '2025-04-01',
          annualCtc: 1,
        })
        .expect(409);
      const history = await prisma.employeeSalaryHistory.findFirstOrThrow({
        where: { employeeId: E1.id },
      });
      expect(history.salaryStructureId).toBe(artStructure.id);

      // Preview: April with v1 (HRA 40%) vs May with v2 (HRA 50%).
      const preview = async (from: string, to: string) =>
        (
          await pm
            .post('/api/v1/payroll/salary/preview', {
              employeeId: E1.id,
              periodStart: from,
              periodEnd: to,
            })
            .expect(200)
        ).body.data as { lines: Line[] };
      const apr = await preview('2025-04-01', '2025-04-30');
      const may = await preview('2025-05-01', '2025-05-31');
      const full = (p: { lines: Line[] }, code: string) =>
        p.lines.find((l) => l.code === code)?.fullAmount;
      expect(full(apr, 'BASIC')).toBe(15000);
      expect(full(apr, 'HRA')).toBe(6000);
      expect(full(apr, 'SPECIAL')).toBe(9000);
      expect(full(may, 'HRA')).toBe(7500);
      expect(full(may, 'SPECIAL')).toBe(7500);
      expect(full(apr, 'PF_EE')).toBeDefined();

      // Per-employee opt-outs (e.g. PF not applicable): excluded components leave the payslip.
      const salaries = (await pm.get(`/api/v1/payroll/employees/${E1.id}/salary`).expect(200)).body
        .data as { id: string; excludedComponents: string[] }[];
      expect(salaries[0]!.excludedComponents).toEqual([]);
      await prisma.employeeSalary.update({
        where: { id: salaries[0]!.id },
        data: { excludedComponents: ['PF_EE', 'PF_ER', 'HRA'] },
      });
      const optedOut = await preview('2025-04-01', '2025-04-30');
      expect(optedOut.lines.find((l) => l.code === 'PF_EE')).toBeUndefined();
      expect(optedOut.lines.find((l) => l.code === 'PF_ER')).toBeUndefined();
      expect(optedOut.lines.find((l) => l.code === 'HRA')).toBeUndefined();
      expect(full(optedOut, 'SPECIAL')).toBe(15000);
      await prisma.employeeSalary.update({
        where: { id: salaries[0]!.id },
        data: { excludedComponents: [] },
      });
    });

    it('creates a loan auto-deducted from payroll', async () => {
      const loan = (
        await pm
          .post('/api/v1/payroll/loans', {
            employeeId: E2.id,
            principal: 2000,
            emiAmount: 1000,
            startMonth: '2025-04-01',
          })
          .expect(201)
      ).body.data;
      expect(loan.installments).toHaveLength(2);
    });

    it('transfers T to MGT mid-April', async () => {
      await owner
        .post(`/api/v1/employees/${T.id}/movements`, {
          type: 'TRANSFER',
          effectiveDate: '2025-04-16',
          toInstitutionId: mgt,
          toDepartmentId: mgtCom,
          reason: 'Mid-period transfer',
        })
        .expect(201);
    });
  });

  describe('April payroll runs', () => {
    it('requires an attendance lock before computing', async () => {
      await owner
        .put(`/api/v1/attendance/policies/${art}`, { absentIsLop: false, timezone: 'Asia/Kolkata' })
        .expect(200);
      await owner
        .put(`/api/v1/attendance/policies/${mgt}`, { absentIsLop: true, timezone: 'Asia/Kolkata' })
        .expect(200);
      const april = days('2025-04', 30);
      await owner
        .post('/api/v1/attendance/punches/import', {
          punches: [
            ...punchesFor(E1.employeeCode, april),
            ...punchesFor(E2.employeeCode, april),
            ...punchesFor(T.employeeCode, april),
            // E3 misses two working days → LOP under MGT's policy.
            ...punchesFor(
              E3.employeeCode,
              april.filter((d) => d !== '2025-04-07' && d !== '2025-04-08'),
            ),
          ],
        })
        .expect(201);

      artApril = (
        await pm
          .post('/api/v1/payroll/runs', {
            institutionId: art,
            periodStart: '2025-04-01',
            periodEnd: '2025-04-30',
          })
          .expect(201)
      ).body.data;
      await pm
        .post('/api/v1/payroll/runs', {
          institutionId: art,
          periodStart: '2025-04-01',
          periodEnd: '2025-04-30',
        })
        .expect(409);
      const r = await pm.post(`/api/v1/payroll/runs/${artApril.id}/compute`).expect(409);
      expect(r.body.error.code).toBe('ATTENDANCE_NOT_LOCKED');

      for (const institutionId of [art, mgt]) {
        await owner
          .post('/api/v1/attendance/locks', {
            institutionId,
            periodStart: '2025-04-01',
            periodEnd: '2025-04-30',
            reason: 'April payroll',
          })
          .expect(201);
      }
    });

    it('computes ART with statutory deductions, loans and a calculation trace', async () => {
      const run = await compute(pm, artApril.id);
      expect(run.attendanceLocked).toBe(true);
      const ids = new Set(
        (
          (await pm.get(`/api/v1/payroll/runs/${artApril.id}/employees?pageSize=100`).expect(200))
            .body.data as RunEmp[]
        ).map((e) => e.employeeId),
      );
      expect(ids).toEqual(new Set([E1.id, E2.id, T.id]));

      const s1 = await summary(E1.id, '2025-04-01', '2025-04-30');
      const e1 = await runEmployee(pm, artApril.id, E1.id);
      expect(e1.status).toBe('OK');
      expect(e1.payableDays).toBe(s1.payableDays + s1.pendingDays);
      expect(e1.calendarDays).toBe(30);
      expect(e1.factor).toBe(1);
      expect(line(e1, 'BASIC')?.amount).toBe(15000);
      expect(line(e1, 'HRA')?.amount).toBe(6000);
      expect(line(e1, 'PF_EE')?.amount).toBe(1800); // 12% of the 15000 ceiling
      expect(line(e1, 'PF_ER')?.amount).toBe(1800);
      expect(line(e1, 'ESI_EE')?.amount ?? 0).toBe(0); // gross 30000 > 21000
      expect(line(e1, 'PT')?.amount).toBe(200); // Karnataka slab
      expect(e1.gross).toBe(30000);
      expect(e1.net).toBe(28000);
      expect(e1.trace.length).toBeGreaterThan(0);
      expect(line(e1, 'SPECIAL')?.explanation).toMatch(/CTC/);

      const e2 = await runEmployee(pm, artApril.id, E2.id);
      expect(e2.gross).toBe(18000);
      expect(line(e2, 'PF_EE')?.amount).toBe(1080);
      expect(line(e2, 'ESI_EE')?.amount).toBe(135); // ceil(0.75% of 18000)
      expect(line(e2, 'ESI_ER')?.amount).toBe(585);
      expect(line(e2, 'PT')?.amount ?? 0).toBe(0);
      expect(line(e2, 'LOAN_EMI')?.amount).toBe(1000);
      expect(e2.net).toBe(18000 - 1080 - 135 - 1000);
    });

    it('splits a mid-period transfer by institution days and pro-rates LOP', async () => {
      mgtApril = (
        await owner
          .post('/api/v1/payroll/runs', {
            institutionId: mgt,
            periodStart: '2025-04-01',
            periodEnd: '2025-04-30',
          })
          .expect(201)
      ).body.data;
      await compute(owner, mgtApril.id);

      const tArt = await runEmployee(pm, artApril.id, T.id);
      const tMgt = await runEmployee(owner, mgtApril.id, T.id);
      expect(tArt.institutionDays).toBe(15);
      expect(tMgt.institutionDays).toBe(15);
      const basicSum = (line(tArt, 'BASIC')?.amount ?? 0) + (line(tMgt, 'BASIC')?.amount ?? 0);
      expect(Math.abs(basicSum - 10000)).toBeLessThanOrEqual(1);
      // Separate institution policies: MGT pays HRA at 50% of BASIC, ART at 40%.
      expect(line(tArt, 'HRA')?.fullAmount).toBe(4000);
      expect(line(tMgt, 'HRA')?.fullAmount).toBe(5000);
      // Employment history preserved: both assignments remain.
      const history = await prisma.employeeDepartment.findMany({
        where: { employeeId: T.id, isPrimary: true },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(history.map((h) => h.institutionId)).toEqual([art, mgt]);

      const s3 = await summary(E3.id, '2025-04-01', '2025-04-30');
      const e3 = await runEmployee(owner, mgtApril.id, E3.id);
      expect(s3.lopDays).toBeGreaterThan(0);
      expect(e3.lopDays).toBe(s3.lopDays);
      expect(e3.payableDays).toBe(s3.payableDays + s3.pendingDays);
      expect(e3.factor).toBeCloseTo(e3.payableDays / 30, 5);
      expect(line(e3, 'BASIC')?.amount).toBe(Math.round(12500 * e3.factor));
      expect(line(e3, 'CONV')?.amount).toBe(1600); // slab on BASIC, not pro-rated
      expect(line(e3, 'ATTB')?.amount ?? 0).toBe(0); // formula: LOP → no bonus
      expect(line(e3, 'PT')?.amount).toBe(200); // Maharashtra slab
    });

    it('approves with maker-checker and finalizes; locked runs are immutable', async () => {
      await pm.post(`/api/v1/payroll/runs/${artApril.id}/submit`).expect(200);
      await pm.post(`/api/v1/payroll/runs/${artApril.id}/decision`, { approved: true }).expect(403);
      // Submitted figures are frozen.
      await pm.post(`/api/v1/payroll/runs/${artApril.id}/compute`).expect(409);
      await fin
        .post(`/api/v1/payroll/runs/${artApril.id}/decision`, { approved: true, comment: 'OK' })
        .expect(200);
      await pm.post(`/api/v1/payroll/runs/${artApril.id}/finalize`).expect(403);
      const final = (await fin.post(`/api/v1/payroll/runs/${artApril.id}/finalize`).expect(200))
        .body.data;
      expect(final.status).toBe('FINALIZED');
      await drainJobs();

      await pm
        .post(`/api/v1/payroll/runs/${artApril.id}/adjustments`, {
          employeeId: E1.id,
          type: 'EARNING',
          amount: 100,
          description: 'Too late',
        })
        .expect(409);
      await pm.post(`/api/v1/payroll/runs/${artApril.id}/compute`).expect(409);
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE payroll_items SET amount = 1 WHERE run_id = ?',
          artApril.id,
        ),
      ).rejects.toThrow(/locked/);
      await expect(
        prisma.$executeRawUnsafe('DELETE FROM payroll_run_employees WHERE run_id = ?', artApril.id),
      ).rejects.toThrow(/locked/);
      await expect(
        prisma.$executeRawUnsafe(
          "UPDATE payroll_runs SET status = 'DRAFT' WHERE id = ?",
          artApril.id,
        ),
      ).rejects.toThrow(/reopened/);

      // Loan installment consumed.
      const loans = (await pm.get(`/api/v1/payroll/loans?employeeId=${E2.id}`).expect(200)).body
        .data;
      expect(loans[0].outstanding).toBe(1000);

      // Payments + bank file.
      const payments = (await fin.get(`/api/v1/payroll/runs/${artApril.id}/payments`).expect(200))
        .body.data as { employeeId: string; amount: number; status: string }[];
      expect(payments.find((p) => p.employeeId === E1.id)?.amount).toBe(28000);
      const file = await fin
        .get(`/api/v1/payroll/runs/${artApril.id}/payments/bank-file`)
        .expect(200);
      expect(file.headers['content-type']).toMatch(/csv/);
      expect(file.text).toContain(E1.employeeCode);
      await fin
        .post(`/api/v1/payroll/runs/${artApril.id}/payments/mark-paid`, { reference: 'UTR-1' })
        .expect(200);
      await expect(
        prisma.$executeRawUnsafe('DELETE FROM payroll_payments WHERE run_id = ?', artApril.id),
      ).rejects.toThrow(/cannot be deleted/);

      // MGT: the owner may approve its own run.
      await owner.post(`/api/v1/payroll/runs/${mgtApril.id}/submit`).expect(200);
      await owner
        .post(`/api/v1/payroll/runs/${mgtApril.id}/decision`, { approved: true })
        .expect(200);
      await owner.post(`/api/v1/payroll/runs/${mgtApril.id}/finalize`).expect(200);
      await drainJobs();
    });

    it('publishes branded payslips with employee self-access only', async () => {
      const mine = (await emp1.get('/api/v1/payroll/me/payslips').expect(200)).body.data as {
        id: string;
        runId: string;
        net: number;
        documentId: string;
      }[];
      const slip = mine.find((p) => p.runId === artApril.id);
      expect(slip?.net).toBe(28000);
      expect(slip?.documentId).toBeTruthy();
      const url = (
        await emp1.post(`/api/v1/payroll/me/payslips/${slip!.id}/download-url`).expect(201)
      ).body.data;
      expect(url.url).toBeTruthy();
      const doc = await prisma.document.findFirstOrThrow({ where: { id: slip!.documentId } });
      expect(doc.category).toBe('payroll');
      // Another employee cannot download it.
      await emp2.post(`/api/v1/payroll/me/payslips/${slip!.id}/download-url`).expect(404);
      expect(
        (
          (await emp2.get('/api/v1/payroll/me/payslips').expect(200)).body.data as { id: string }[]
        ).map((p) => p.id),
      ).not.toContain(slip!.id);
      await emp1.get('/api/v1/payroll/runs').expect(403);
      const run = (await pm.get(`/api/v1/payroll/runs/${artApril.id}`).expect(200)).body.data;
      expect(run.payslipsPublishedAt).toBeTruthy();
    });

    it('scopes reports and the group consolidated summary', async () => {
      const register = await fin
        .get(`/api/v1/payroll/reports/runs/${artApril.id}/register?format=csv`)
        .expect(200);
      expect(register.text).toContain(E1.employeeCode);
      const xlsx = await fin
        .get(`/api/v1/payroll/reports/runs/${artApril.id}/components?format=xlsx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const pf = (
        await fin.get(`/api/v1/payroll/reports/statutory?runId=${artApril.id}&pack=PF`).expect(200)
      ).body.data;
      expect(pf.totals).toBeTruthy();
      await fin
        .get(`/api/v1/payroll/reports/statutory?runId=${artApril.id}&pack=PF&format=pdf`)
        .expect('content-type', /pdf/)
        .expect(200);

      const q = 'periodStart=2025-04-01&periodEnd=2025-04-30';
      const group = (await gfin.get(`/api/v1/payroll/reports/group-summary?${q}`).expect(200)).body
        .data;
      const instIds = group.institutions.map((i: { institutionId: string }) => i.institutionId);
      expect(instIds).toEqual(expect.arrayContaining([art, mgt]));
      expect(group.totals.employeeCount).toBeGreaterThanOrEqual(5);
      const scoped = (await fin.get(`/api/v1/payroll/reports/group-summary?${q}`).expect(200)).body
        .data;
      expect(scoped.institutions.map((i: { institutionId: string }) => i.institutionId)).toEqual([
        art,
      ]);
      await fin
        .get(`/api/v1/payroll/reports/runs/${mgtApril.id}/register`)
        .expect((r) => expect([403, 404]).toContain(r.status));
      expect(groupId).toBeTruthy();
    });

    it('isolates tenants (BCC cannot see ABBS payroll)', async () => {
      await bcc.get(`/api/v1/payroll/runs/${artApril.id}`).expect(404);
      const runs = (await bcc.get('/api/v1/payroll/runs').expect(200)).body.data as {
        id: string;
      }[];
      expect(runs.map((r) => r.id)).not.toContain(artApril.id);
      await bcc.get(`/api/v1/payroll/runs/${artApril.id}/employees/${E1.id}`).expect(404);
      const comps = (await bcc.get('/api/v1/payroll/components').expect(200)).body.data as {
        code: string;
      }[];
      expect(comps.map((c) => c.code)).not.toContain('CONV');
    });

    it('reopens only with permission and a reason, creating an audited new revision', async () => {
      await fin
        .post(`/api/v1/payroll/runs/${mgtApril.id}/reopen`, { reason: 'Correct bonus' })
        .expect((r) => expect([403, 404]).toContain(r.status));
      await gfin.post(`/api/v1/payroll/runs/${mgtApril.id}/reopen`, { reason: 'x' }).expect(400);
      const next = (
        await gfin
          .post(`/api/v1/payroll/runs/${mgtApril.id}/reopen`, {
            reason: 'Correct attendance bonus',
          })
          .expect(201)
      ).body.data;
      expect(next).toMatchObject({ status: 'DRAFT', revision: 2, previousRunId: mgtApril.id });
      const old = (await gfin.get(`/api/v1/payroll/runs/${mgtApril.id}`).expect(200)).body.data;
      expect(old).toMatchObject({ status: 'REOPENED', reopenReason: 'Correct attendance bonus' });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'payroll.run.reopen', entityId: mgtApril.id },
      });
      expect(audit?.reason).toBe('Correct attendance bonus');
      // The superseded revision stays immutable.
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE payroll_items SET amount = 1 WHERE run_id = ?',
          mgtApril.id,
        ),
      ).rejects.toThrow(/locked/);
      await owner.post(`/api/v1/payroll/runs/${next.id}/cancel`).expect(200);
    });
  });

  describe('revisions, reimbursements and May payroll', () => {
    it('applies a back-dated revision via workflow with arrears', async () => {
      const def = (
        await owner
          .post('/api/v1/workflows/definitions', {
            entityType: 'salary_revision',
            name: 'Salary revision approval',
            steps: [
              {
                key: 'owner',
                name: 'Owner',
                approvers: [{ type: 'user', userIds: [userIds['owner@abbs.test']] }],
              },
            ],
          })
          .expect(201)
      ).body.data;
      try {
        const rev = (
          await pm
            .post('/api/v1/payroll/revisions', {
              employeeId: E1.id,
              effectiveFrom: '2025-04-01',
              annualCtc: 420000,
              reason: 'Annual increment (back-dated)',
            })
            .expect(201)
        ).body.data;
        expect(rev.status).toBe('PENDING_APPROVAL');
        expect(rev.workflowInstanceId).toBeTruthy();
        await owner
          .post(`/api/v1/workflows/instances/${rev.workflowInstanceId}/actions`, {
            action: 'approve',
          })
          .expect(200);
        await drainJobs();
        const applied = (await pm.get(`/api/v1/payroll/revisions/${rev.id}`).expect(200)).body.data;
        expect(applied.status).toBe('APPLIED');
        expect(applied.arrearsAmount).toBe(5000); // April earnings 35000 - 30000
      } finally {
        await archive(def.id);
      }
      // History preserved: both rows remain, the old one untouched.
      const history = await prisma.employeeSalaryHistory.findMany({
        where: { employeeId: E1.id },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(history.map((h) => Number(h.annualCtc))).toEqual([360000, 420000]);
    });

    it('feeds approved reimbursement claims into payroll adjustments', async () => {
      const claim = (
        await emp2
          .post('/api/v1/payroll/me/reimbursements', {
            category: 'Travel',
            amount: 750,
            claimDate: '2025-05-05',
            description: 'Conference travel',
          })
          .expect(201)
      ).body.data;
      // Claimant cannot approve; payroll approves directly (no workflow defined).
      await emp2
        .post(`/api/v1/payroll/reimbursements/${claim.id}/decision`, { approved: true })
        .expect(403);
      await fin
        .post(`/api/v1/payroll/reimbursements/${claim.id}/decision`, { approved: true })
        .expect((r) => expect([200, 403]).toContain(r.status));
      const decided = await prisma.reimbursementClaim.findFirstOrThrow({ where: { id: claim.id } });
      if (decided.status !== 'APPROVED') {
        await owner
          .post(`/api/v1/payroll/reimbursements/${claim.id}/decision`, { approved: true })
          .expect(200);
      }
    });

    it('runs May through the payroll_run workflow with arrears and adjustments', async () => {
      const may = days('2025-05', 31);
      await owner
        .post('/api/v1/attendance/punches/import', {
          punches: [...punchesFor(E1.employeeCode, may), ...punchesFor(E2.employeeCode, may)],
        })
        .expect(201);
      await owner
        .post('/api/v1/attendance/locks', {
          institutionId: art,
          periodStart: '2025-05-01',
          periodEnd: '2025-05-31',
          reason: 'May payroll',
        })
        .expect(201);
      const run = (
        await pm
          .post('/api/v1/payroll/runs', {
            institutionId: art,
            periodStart: '2025-05-01',
            periodEnd: '2025-05-31',
          })
          .expect(201)
      ).body.data;
      await compute(pm, run.id);
      await pm
        .post(`/api/v1/payroll/runs/${run.id}/adjustments`, {
          employeeId: E2.id,
          type: 'EARNING',
          code: 'BONUS',
          amount: 1500,
          description: 'Spot award',
        })
        .expect(201);
      await compute(pm, run.id); // re-run before approval

      const e1 = await runEmployee(pm, run.id, E1.id);
      expect(line(e1, 'BASIC')?.amount).toBe(17500);
      expect(line(e1, 'HRA')?.amount).toBe(8750); // structure v2
      expect(line(e1, 'ARREARS')?.amount).toBe(5000);
      expect(e1.gross).toBe(40000);
      const e2 = await runEmployee(pm, run.id, E2.id);
      expect(line(e2, 'BONUS')?.amount).toBe(1500);
      expect(line(e2, 'REIMB')?.amount).toBe(750);
      expect(line(e2, 'LOAN_EMI')?.amount).toBe(1000);

      const def = (
        await owner
          .post('/api/v1/workflows/definitions', {
            entityType: 'payroll_run',
            name: 'Payroll approval',
            steps: [
              {
                key: 'finance',
                name: 'Finance',
                approvers: [{ type: 'user', userIds: [userIds[FIN]] }],
              },
            ],
          })
          .expect(201)
      ).body.data;
      try {
        const submitted = (await pm.post(`/api/v1/payroll/runs/${run.id}/submit`).expect(200)).body
          .data;
        expect(submitted.workflowInstanceId).toBeTruthy();
        const direct = await fin
          .post(`/api/v1/payroll/runs/${run.id}/decision`, { approved: true })
          .expect(409);
        expect(direct.body.error.code).toBe('WORKFLOW_MANAGED');
        await fin
          .post(`/api/v1/workflows/instances/${submitted.workflowInstanceId}/actions`, {
            action: 'approve',
          })
          .expect(200);
        await drainJobs();
        expect((await pm.get(`/api/v1/payroll/runs/${run.id}`).expect(200)).body.data.status).toBe(
          'APPROVED',
        );
        await fin.post(`/api/v1/payroll/runs/${run.id}/finalize`).expect(200);
        await drainJobs();
      } finally {
        await archive(def.id);
      }
      const loans = (await pm.get(`/api/v1/payroll/loans?employeeId=${E2.id}`).expect(200)).body
        .data;
      expect(loans[0]).toMatchObject({ status: 'CLOSED', outstanding: 0 });
      const slips = (await emp1.get('/api/v1/payroll/me/payslips').expect(200)).body.data;
      expect(slips.length).toBe(2);
    });

    it('publishes Form 16 records securely per employee', async () => {
      const rec = (
        await pm
          .post('/api/v1/payroll/form16/generate', { employeeId: E1.id, financialYear: '2025-26' })
          .expect((r) => expect([200, 201]).toContain(r.status))
      ).body.data;
      await pm.post(`/api/v1/payroll/form16/${rec.id}/publish`).expect(200);
      const mine = (await emp1.get('/api/v1/payroll/me/form16').expect(200)).body.data as {
        id: string;
      }[];
      expect(mine.map((f) => f.id)).toContain(rec.id);
      await emp1.post(`/api/v1/payroll/me/form16/${rec.id}/download-url`).expect(201);
      await emp2.post(`/api/v1/payroll/me/form16/${rec.id}/download-url`).expect(404);
    });
  });
});

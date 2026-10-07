import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { drainJobs, runAsSystem } from '../src/core/queue';
import { getReportingManagerResolver } from '../src/core/workflow';
import {
  employeeAssignmentAsOf,
  reportingManagerUserIds,
} from '../src/modules/employees/employees.assignment';
import { applyDueMovements } from '../src/modules/employees/employees.movements';
import { salaryAsOf } from '../src/modules/employees/employees.salary';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asTenant,
  hasTestDatabase,
  login,
  seedAccessFixture,
  signIn,
} from './helpers';

const REASON = 'Billing ticket #990: employee limit test';
const SELF = 'self.employee@abbs.test';
const MANAGER = 'line.manager@abbs.test';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

type Client = Awaited<ReturnType<typeof signIn>>;

describe.skipIf(!hasTestDatabase)('HR employee master', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;
  let userIds: Record<string, string>;
  let abbs: string;
  let eng: string;
  let com: string;
  let engCse: string;
  let engCom: string;
  let comCom: string;
  let comCse: string;
  let owner: Client;
  let groupHr: Client;
  let engHr: Client;
  let seq = 0;

  const name = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq += 1)}`;
  const createEmployee = async (who: Client, body: Record<string, unknown>, status = 201) =>
    (
      await who
        .post('/api/v1/employees', {
          employmentType: 'TEACHING',
          firstName: name('Emp'),
          lastName: 'Test',
          ...body,
        })
        .expect(status)
    ).body;

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    orgIds = fixture.orgIds;
    abbs = orgIds.abbs!;
    const { seedAccessControl } = await import('../prisma/seed-access');
    const extra = await seedAccessControl(prisma, orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: SELF,
          name: 'Self Service Employee',
          organization: 'abbs',
          role: 'employee',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
        {
          email: MANAGER,
          name: 'Line Manager',
          organization: 'abbs',
          role: 'employee',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
      ],
    });
    userIds = { ...fixture.userIds, ...extra };
    const inst = async (code: string) =>
      (await prisma.institution.findFirstOrThrow({ where: { organizationId: abbs, code } })).id;
    eng = await inst('ABBS-ENG');
    com = await inst('ABBS-COM');
    const dept = async (institutionId: string, code: string) =>
      (await prisma.department.findFirstOrThrow({ where: { institutionId, code } })).id;
    engCse = await dept(eng, 'CSE');
    engCom = await dept(eng, 'COM');
    comCom = await dept(com, 'COM');
    comCse = await dept(com, 'CSE');
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    groupHr = await signIn(app, 'group.hr@abbs.test', DEMO_PASSWORD);
    engHr = await signIn(app, 'eng.hr@abbs.test', DEMO_PASSWORD);
    await prisma.workflowDefinition.deleteMany({
      where: {
        organizationId: abbs,
        entityType: { in: ['employee_transfer', 'employee_profile_change'] },
      },
    });
  });

  afterAll(async () => {
    await drainJobs();
  });

  it('registers the HR entity types, events and the reporting-manager resolver', async () => {
    const types = (await owner.get('/api/v1/workflows/entity-types').expect(200)).body.data;
    expect(types.map((t: { entityType: string }) => t.entityType)).toEqual(
      expect.arrayContaining(['employee_transfer', 'employee_profile_change']),
    );
    expect(getReportingManagerResolver()).toBe(reportingManagerUserIds);
  });

  it('enforces scope: group HR vs institution HR vs another organization', async () => {
    const inCom = (
      await createEmployee(groupHr, {
        institutionId: com,
        departmentId: comCom,
        status: 'ACTIVE',
        dateOfJoining: '2024-01-01',
      })
    ).data;
    expect(inCom.employeeCode).toBeTruthy();
    expect(inCom).toMatchObject({ institutionId: com, status: 'ACTIVE' });

    const inEng = (
      await createEmployee(engHr, {
        institutionId: eng,
        departmentId: engCse,
        status: 'ACTIVE',
        dateOfJoining: '2024-01-01',
      })
    ).data;
    expect(inEng.groupId).toBe(inCom.groupId);

    // Institution HR cannot create outside the assigned institution.
    await createEmployee(engHr, { institutionId: com }, 403);

    const engList = (await engHr.get('/api/v1/employees?pageSize=100').expect(200)).body.data;
    expect(engList.length).toBeGreaterThan(0);
    expect(engList.every((e: { institutionId: string }) => e.institutionId === eng)).toBe(true);
    const groupList = (await groupHr.get('/api/v1/employees?pageSize=100').expect(200)).body.data;
    const groupIds = groupList.map((e: { id: string }) => e.id);
    expect(groupIds).toEqual(expect.arrayContaining([inCom.id, inEng.id]));

    await engHr.get(`/api/v1/employees/${inCom.id}`).expect(404);
    await engHr.patch(`/api/v1/employees/${inCom.id}`, { firstName: 'Nope' }).expect(404);
    await groupHr.get(`/api/v1/employees/${inEng.id}`).expect(200);

    // Another tenant never sees ABBS employees.
    const bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    await bcc.get(`/api/v1/employees/${inEng.id}`).expect(404);
    const bccList = (await bcc.get('/api/v1/employees?pageSize=100').expect(200)).body.data;
    expect(bccList.map((e: { id: string }) => e.id)).not.toContain(inEng.id);
    const devBcc = asTenant(app, 'bcc');
    await devBcc.get(`/api/v1/employees/${inEng.id}`).expect(404);

    // Assignment of a non-draft employee changes only via movements.
    const res = await engHr
      .patch(`/api/v1/employees/${inEng.id}`, { departmentId: engCom })
      .expect(409);
    expect(res.body.error.code).toBe('USE_MOVEMENT');
    await engHr.patch(`/api/v1/employees/${inEng.id}`, { workPhone: '+919800000001' }).expect(200);
  });

  it('enforces the employees plan limit and the hr feature', async () => {
    const jp = asTenant(app, 'jp-college');
    const jpInst = await prisma.institution.findFirstOrThrow({
      where: { organizationId: orgIds['jp-college']! },
    });
    const disabled = await jp
      .post('/api/v1/employees', {
        institutionId: jpInst.id,
        employmentType: 'TEACHING',
        firstName: 'Nope',
      })
      .expect(403);
    expect(disabled.body.error.code).toBe('FEATURE_DISABLED');

    const bccId = orgIds.bcc!;
    const bccInst = await prisma.institution.findFirstOrThrow({
      where: { organizationId: bccId, code: 'BCC-A' },
    });
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const sub = (
      await platform.get(`/api/v1/platform/organizations/${bccId}/subscription`).expect(200)
    ).body.data;
    const setLimit = (limitOverrides: Record<string, number | null>) =>
      platform
        .put(`/api/v1/platform/organizations/${bccId}/subscription`, {
          planId: sub.plan.id,
          status: 'ACTIVE',
          limitOverrides,
          reason: REASON,
        })
        .expect(200);
    const used = await prisma.employee.count({
      where: { organizationId: bccId, deletedAt: null, status: { not: 'EXITED' } },
    });
    await setLimit({ employees: used + 1 });
    const bcc = asTenant(app, 'bcc');
    try {
      const first = await bcc
        .post('/api/v1/employees', {
          institutionId: bccInst.id,
          employmentType: 'NON_TEACHING',
          firstName: 'Limit',
        })
        .expect(201);
      const second = await bcc
        .post('/api/v1/employees', {
          institutionId: bccInst.id,
          employmentType: 'NON_TEACHING',
          firstName: 'Over',
        })
        .expect(403);
      expect(second.body.error).toMatchObject({
        code: 'LIMIT_EXCEEDED',
        details: { limitKey: 'employees' },
      });
      // Deleting a draft releases the reservation.
      await bcc.delete(`/api/v1/employees/${first.body.data.id}`).expect(204);
      await bcc
        .post('/api/v1/employees', {
          institutionId: bccInst.id,
          employmentType: 'NON_TEACHING',
          firstName: 'Again',
        })
        .expect(201);
    } finally {
      await setLimit({});
    }
  });

  it('encrypts sensitive fields, masks them and audits reveals', async () => {
    const pan = 'ABCDE1234F';
    const aadhaar = '987654321012';
    const account = '0011223344556677';
    const emp = (
      await createEmployee(engHr, {
        institutionId: eng,
        status: 'ACTIVE',
        dateOfJoining: '2024-02-01',
        sensitive: {
          pan,
          aadhaar,
          bankAccount: {
            accountHolderName: 'Test Holder',
            accountNumber: account,
            ifsc: 'HDFC0001234',
          },
        },
      })
    ).data;
    const detail = (await engHr.get(`/api/v1/employees/${emp.id}`).expect(200)).body.data;
    expect(detail.profile.hasSensitive).toBe(true);
    expect(detail.profile.sensitive.pan).toBe('XXXXXX234F');
    expect(detail.profile.sensitive.bankAccount.accountNumber).toMatch(/^X+6677$/);
    expect(JSON.stringify(detail)).not.toContain(pan);
    expect(JSON.stringify(detail)).not.toContain(aadhaar);

    const row = await prisma.employeeProfile.findFirstOrThrow({ where: { employeeId: emp.id } });
    const raw = JSON.stringify(row);
    expect(row.sensitiveCiphertext).toBeTruthy();
    expect(raw).not.toContain(pan);
    expect(raw).not.toContain(aadhaar);
    expect(raw).not.toContain(account);

    // Self-service users cannot reveal.
    const self = await signIn(app, SELF, DEMO_PASSWORD);
    await self.post(`/api/v1/employees/${emp.id}/sensitive/reveal`, {}).expect(403);

    const revealed = (
      await engHr
        .post(`/api/v1/employees/${emp.id}/sensitive/reveal`, { reason: 'Payroll setup' })
        .expect(200)
    ).body.data;
    expect(revealed).toMatchObject({ pan, aadhaar, bankAccount: { accountNumber: account } });

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: abbs, entityType: 'employee', entityId: emp.id },
    });
    const reveal = audits.find((a) => a.action === 'employee.sensitive_view');
    expect(reveal).toMatchObject({
      actorUserId: userIds['eng.hr@abbs.test'],
      reason: 'Payroll setup',
    });
    const allAudit = JSON.stringify(audits);
    expect(allAudit).not.toContain(pan);
    expect(allAudit).not.toContain(aadhaar);
    expect(allAudit).not.toContain(account);
  });

  it('transfers within the group while keeping history intact', async () => {
    const emp = (
      await createEmployee(groupHr, {
        institutionId: eng,
        departmentId: engCse,
        status: 'ACTIVE',
        dateOfJoining: '2024-01-01',
      })
    ).data;
    await groupHr
      .post(`/api/v1/employees/${emp.id}/salary`, {
        effectiveFrom: '2024-01-01',
        annualCtc: 600000,
        amounts: { basic: 25000, hra: 10000 },
        revisionReason: 'Joining',
      })
      .expect(201);

    const effective = today();
    const movement = (
      await groupHr
        .post(`/api/v1/employees/${emp.id}/movements`, {
          type: 'TRANSFER',
          effectiveDate: effective,
          toInstitutionId: com,
          toDepartmentId: comCom,
          reason: 'Needed at commerce college',
        })
        .expect(201)
    ).body.data;
    expect(movement).toMatchObject({
      status: 'APPLIED',
      fromInstitutionId: eng,
      toInstitutionId: com,
    });
    const after = (await groupHr.get(`/api/v1/employees/${emp.id}`).expect(200)).body.data;
    expect(after).toMatchObject({ institutionId: com, departmentId: comCom });

    const history = (await groupHr.get(`/api/v1/employees/${emp.id}/history`).expect(200)).body
      .data;
    const oldDept = history.departments.find(
      (d: { institutionId: string }) => d.institutionId === eng,
    );
    expect(oldDept).toMatchObject({
      departmentId: engCse,
      effectiveFrom: '2024-01-01',
      effectiveTo: addDays(effective, -1),
    });
    const newDept = history.departments.find(
      (d: { institutionId: string }) => d.institutionId === com,
    );
    expect(newDept).toMatchObject({ effectiveFrom: effective, effectiveTo: null });
    expect(history.positions.map((p: { institutionId: string }) => p.institutionId).sort()).toEqual(
      [com, eng].sort(),
    );

    // Salary rows keep the old institution; the as-of helpers answer historical questions.
    const salary = (await groupHr.get(`/api/v1/employees/${emp.id}/salary`).expect(200)).body.data;
    expect(salary[0]).toMatchObject({ institutionId: eng, annualCtc: 600000 });
    const before = await runAsSystem(abbs, () => employeeAssignmentAsOf(emp.id, '2024-06-01'));
    expect(before).toMatchObject({ institutionId: eng, departmentId: engCse });
    const now = await runAsSystem(abbs, () => employeeAssignmentAsOf(emp.id, effective));
    expect(now).toMatchObject({ institutionId: com, departmentId: comCom });
    const ctc = await runAsSystem(abbs, () => salaryAsOf(emp.id, '2024-06-01'));
    expect(ctc?.annualCtc).toBe(600000);

    // The source institution HR loses access; the movement is visible to group HR.
    await engHr.get(`/api/v1/employees/${emp.id}`).expect(404);
    const movements = (await groupHr.get(`/api/v1/employees/${emp.id}/movements`).expect(200)).body
      .data;
    expect(movements).toHaveLength(1);

    // Future-dated movements are scheduled and applied by the daily job.
    const future = addDays(effective, 10);
    const scheduled = (
      await groupHr
        .post(`/api/v1/employees/${emp.id}/movements`, {
          type: 'DEPARTMENT_CHANGE',
          effectiveDate: future,
          toDepartmentId: comCse,
          reason: 'Pool',
        })
        .expect(201)
    ).body.data;
    expect(scheduled.status).toBe('SCHEDULED');
    expect(await runAsSystem(abbs, () => applyDueMovements(effective))).toBe(0);
    expect(await runAsSystem(abbs, () => applyDueMovements(future))).toBe(1);
    const moved = await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(moved.departmentId).toBe(comCse);

    const events = await prisma.domainEvent.findMany({
      where: { organizationId: abbs, eventKey: 'employee.transferred' },
    });
    expect(events.some((e) => (e.payload as { employeeId?: string }).employeeId === emp.id)).toBe(
      true,
    );
  });

  it('routes transfers through the employee_transfer workflow when defined', async () => {
    const def = (
      await owner
        .post('/api/v1/workflows/definitions', {
          entityType: 'employee_transfer',
          name: 'Transfer approval',
          steps: [
            {
              key: 'group_hr',
              name: 'Group HR',
              approvers: [{ type: 'role', roleKey: 'group_hr' }],
            },
          ],
        })
        .expect(201)
    ).body.data;
    try {
      const emp = (
        await createEmployee(engHr, {
          institutionId: eng,
          departmentId: engCse,
          status: 'ACTIVE',
          dateOfJoining: '2024-01-01',
        })
      ).data;
      const movement = (
        await engHr
          .post(`/api/v1/employees/${emp.id}/movements`, {
            type: 'DEPARTMENT_CHANGE',
            effectiveDate: today(),
            toDepartmentId: engCom,
            reason: 'Re-org',
          })
          .expect(201)
      ).body.data;
      expect(movement.status).toBe('PENDING_APPROVAL');
      expect(movement.workflowInstanceId).toBeTruthy();
      const unchanged = (await engHr.get(`/api/v1/employees/${emp.id}`).expect(200)).body.data;
      expect(unchanged.departmentId).toBe(engCse);
      // A second request is refused while one is pending.
      await engHr
        .post(`/api/v1/employees/${emp.id}/movements`, {
          type: 'DEPARTMENT_CHANGE',
          effectiveDate: today(),
          toDepartmentId: null,
          reason: 'Again',
        })
        .expect(409);

      const inbox = (await groupHr.get('/api/v1/workflows/inbox').expect(200)).body.data;
      expect(inbox.map((i: { id: string }) => i.id)).toContain(movement.workflowInstanceId);
      await engHr
        .post(`/api/v1/workflows/instances/${movement.workflowInstanceId}/actions`, {
          action: 'approve',
        })
        .expect(403);
      await groupHr
        .post(`/api/v1/workflows/instances/${movement.workflowInstanceId}/actions`, {
          action: 'approve',
          comment: 'Approved',
        })
        .expect(200);
      await drainJobs();
      const applied = (await engHr.get(`/api/v1/employees/${emp.id}/movements`).expect(200)).body
        .data;
      expect(applied[0]).toMatchObject({ status: 'APPLIED', decidedComment: 'Approved' });
      const now = (await engHr.get(`/api/v1/employees/${emp.id}`).expect(200)).body.data;
      expect(now.departmentId).toBe(engCom);
    } finally {
      await prisma.workflowDefinition.update({
        where: { id: def.id },
        data: { status: 'ARCHIVED' },
      });
    }
  });

  describe('self-service, reporting manager and documents', () => {
    let selfEmp: { id: string };
    let managerEmp: { id: string };

    beforeAll(async () => {
      managerEmp = (
        await createEmployee(engHr, {
          institutionId: eng,
          departmentId: engCse,
          status: 'ACTIVE',
          dateOfJoining: '2023-01-01',
          userId: userIds[MANAGER],
        })
      ).data;
      selfEmp = (
        await createEmployee(engHr, {
          institutionId: eng,
          departmentId: engCse,
          status: 'ACTIVE',
          dateOfJoining: '2024-01-01',
          userId: userIds[SELF],
          reportingManagerId: managerEmp.id,
          sensitive: { pan: 'PQRSX6789K' },
        })
      ).data;
    });

    it('resolves the reporting chain', async () => {
      const managers = await runAsSystem(abbs, () => reportingManagerUserIds(userIds[SELF]!, 2));
      expect(managers).toEqual([userIds[MANAGER]]);
      // Cycles are refused.
      const res = await engHr
        .post(`/api/v1/employees/${managerEmp.id}/movements`, {
          type: 'REPORTING_CHANGE',
          effectiveDate: today(),
          toReportingManagerId: selfEmp.id,
          reason: 'Cycle',
        })
        .expect(422);
      expect(res.body.error.code).toBe('REPORTING_CYCLE');
    });

    it('shows the own (masked) profile and applies change requests via the reporting manager', async () => {
      const self = await signIn(app, SELF, DEMO_PASSWORD);
      const me = (await self.get('/api/v1/employees/me').expect(200)).body.data;
      expect(me.id).toBe(selfEmp.id);
      expect(me.profile.sensitive.pan).toBe('XXXXXX789K');
      await self.get('/api/v1/employees').expect(403);
      await self.get(`/api/v1/employees/${selfEmp.id}`).expect(403);

      // Without a workflow definition the change applies directly.
      const direct = (
        await self
          .post('/api/v1/employees/me/change-requests', {
            changes: { bloodGroup: 'O+' },
          })
          .expect(201)
      ).body.data;
      expect(direct.status).toBe('APPLIED');

      const def = (
        await owner
          .post('/api/v1/workflows/definitions', {
            entityType: 'employee_profile_change',
            name: 'Profile change approval',
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
        const pending = (
          await self
            .post('/api/v1/employees/me/change-requests', {
              changes: { personalPhone: '+919876543210' },
              reason: 'New number',
            })
            .expect(201)
        ).body.data;
        expect(pending.status).toBe('PENDING_APPROVAL');
        await self
          .post('/api/v1/employees/me/change-requests', { changes: { bloodGroup: 'A+' } })
          .expect(409);

        const manager = await signIn(app, MANAGER, DEMO_PASSWORD);
        const inbox = (await manager.get('/api/v1/workflows/inbox').expect(200)).body.data;
        expect(inbox.map((i: { id: string }) => i.id)).toContain(pending.workflowInstanceId);
        await manager
          .post(`/api/v1/workflows/instances/${pending.workflowInstanceId}/actions`, {
            action: 'approve',
          })
          .expect(200);
        await drainJobs();
        const me2 = (await self.get('/api/v1/employees/me').expect(200)).body.data;
        expect(me2.profile.personal).toMatchObject({
          personalPhone: '+919876543210',
          bloodGroup: 'O+',
        });
        const notes = await prisma.notification.findMany({
          where: { userId: userIds[SELF]!, eventKey: 'employee.profile_change_decided' },
        });
        expect(notes.length).toBeGreaterThan(0);
      } finally {
        await prisma.workflowDefinition.update({
          where: { id: def.id },
          data: { status: 'ARCHIVED' },
        });
      }
    });

    it('generates branded letters as employee documents visible to the employee', async () => {
      const offer = (
        await engHr
          .post(`/api/v1/employees/${selfEmp.id}/letters`, {
            type: 'offer',
            annualCtc: 720000,
            acceptBy: addDays(today(), 7),
          })
          .expect(201)
      ).body.data;
      expect(offer).toMatchObject({
        ownerType: 'employee',
        ownerId: selfEmp.id,
        institutionId: eng,
        metadata: { templateKey: 'hr_offer_letter' },
        currentVersion: { mimeType: 'application/pdf' },
      });
      expect(offer.metadata.branding).toBeTruthy();
      expect(offer.metadata.branding.displayName).toBeTruthy();
      const experience = (
        await engHr
          .post(`/api/v1/employees/${managerEmp.id}/letters`, { type: 'experience' })
          .expect(201)
      ).body.data;
      expect(experience.metadata.templateKey).toBe('hr_experience_letter');
      // Relieving letters need a resignation (last working date) or an exit.
      await engHr
        .post(`/api/v1/employees/${selfEmp.id}/letters`, { type: 'relieving' })
        .expect(409);

      const self = await signIn(app, SELF, DEMO_PASSWORD);
      const mine = (await self.get('/api/v1/documents?pageSize=100').expect(200)).body.data;
      const ids = mine.map((d: { id: string }) => d.id);
      expect(ids).toContain(offer.id);
      expect(ids).not.toContain(experience.id);
      await self.post(`/api/v1/documents/${offer.id}/download-url`, {}).expect(201);
      await self.delete(`/api/v1/documents/${offer.id}`).expect(403);
      await self.get(`/api/v1/documents/${experience.id}`).expect(404);

      // HR in scope sees the document; HR of another institution does not.
      await groupHr.get(`/api/v1/documents/${offer.id}`).expect(200);
      const bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
      await bcc.get(`/api/v1/documents/${offer.id}`).expect(404);
    });
  });

  it('runs the exit lifecycle with the exit checklist, relieving letter and rehire', async () => {
    const emp = (
      await createEmployee(engHr, {
        institutionId: eng,
        status: 'ONBOARDING',
        dateOfJoining: '2024-03-01',
      })
    ).data;
    const onboarding = (await engHr.get(`/api/v1/employees/${emp.id}/checklist`).expect(200)).body
      .data;
    expect(onboarding.some((i: { kind: string }) => i.kind === 'ONBOARDING')).toBe(true);
    await engHr.post(`/api/v1/employees/${emp.id}/activate`, {}).expect(200);
    await engHr
      .post(`/api/v1/employees/${emp.id}/confirm`, { confirmationDate: '2024-09-01' })
      .expect(200);
    const lwd = today();
    const resigned = (
      await engHr
        .post(`/api/v1/employees/${emp.id}/resign`, {
          resignationDate: addDays(lwd, -30),
          lastWorkingDate: lwd,
          reason: 'Higher studies',
        })
        .expect(200)
    ).body.data;
    expect(resigned.status).toBe('ON_NOTICE');

    const blocked = await engHr
      .post(`/api/v1/employees/${emp.id}/exit`, { exitDate: lwd, exitType: 'RESIGNATION' })
      .expect(409);
    expect(blocked.body.error.code).toBe('EXIT_CHECKLIST_PENDING');
    const items = (await engHr.get(`/api/v1/employees/${emp.id}/checklist`).expect(200)).body.data;
    for (const item of items.filter(
      (i: { kind: string; status: string }) => i.kind === 'EXIT' && i.status === 'PENDING',
    )) {
      await engHr
        .patch(`/api/v1/employees/${emp.id}/checklist/${item.id}`, { status: 'DONE' })
        .expect(200);
    }
    const exited = (
      await engHr
        .post(`/api/v1/employees/${emp.id}/exit`, { exitDate: lwd, exitType: 'RESIGNATION' })
        .expect(200)
    ).body.data;
    expect(exited).toMatchObject({ status: 'EXITED', exitDate: lwd });

    const relieving = (
      await engHr.post(`/api/v1/employees/${emp.id}/letters`, { type: 'relieving' }).expect(201)
    ).body.data;
    expect(relieving.metadata.templateKey).toBe('hr_relieving_letter');

    const history = (await engHr.get(`/api/v1/employees/${emp.id}/history`).expect(200)).body.data;
    expect(
      history.positions.every((p: { effectiveTo: string | null }) => p.effectiveTo === lwd),
    ).toBe(true);

    const rehired = (
      await engHr
        .post(`/api/v1/employees/${emp.id}/rehire`, { dateOfJoining: addDays(lwd, 30) })
        .expect(200)
    ).body.data;
    expect(rehired).toMatchObject({ status: 'ONBOARDING', rehireCount: 1, exitDate: null });
  });

  it('imports employees from CSV via a queue job with a validation report, and exports CSV', async () => {
    const tokens = await login(app, 'group.hr@abbs.test', DEMO_PASSWORD);
    const code = name('IMP').toUpperCase();
    const csv = [
      'employeeCode,firstName,lastName,institutionCode,departmentCode,employmentType,status,dateOfJoining,pan',
      `${code},Imported,One,ABBS-ENG,CSE,teaching,active,2024-04-01,ABCDE1111A`,
      `${code}-2,Bad,Institution,NOPE,,TEACHING,,,`,
      `${code}-3,Bad,Pan,ABBS-COM,,non-teaching,,,123`,
    ].join('\n');
    const upload = (dryRun: boolean) =>
      supertest(app)
        .post('/api/v1/employees/import')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .field('dryRun', String(dryRun))
        .attach('file', Buffer.from(csv), { filename: 'employees.csv', contentType: 'text/csv' })
        .expect(202);

    const dry = (await upload(true)).body.data;
    await drainJobs();
    const dryJob = (await groupHr.get(`/api/v1/employees/import/${dry.id}`).expect(200)).body.data;
    expect(dryJob).toMatchObject({
      status: 'COMPLETED',
      totalRows: 3,
      createdCount: 0,
      errorCount: 2,
    });
    expect(await prisma.employee.count({ where: { employeeCode: code } })).toBe(0);

    const real = (await upload(false)).body.data;
    await drainJobs();
    const job = (await groupHr.get(`/api/v1/employees/import/${real.id}`).expect(200)).body.data;
    expect(job).toMatchObject({
      status: 'COMPLETED',
      totalRows: 3,
      createdCount: 1,
      errorCount: 2,
    });
    expect(job.report[0]).toMatchObject({ row: 2, employeeCode: code, errors: [] });
    expect(job.report[1].errors[0].field).toBe('institutionCode');
    expect(job.report[2].errors.map((e: { field: string }) => e.field)).toContain('sensitive.pan');
    const created = await prisma.employee.findFirstOrThrow({
      where: { organizationId: abbs, employeeCode: code },
    });
    expect(created).toMatchObject({ institutionId: eng, departmentId: engCse, status: 'ACTIVE' });

    // Institution HR may not read someone else's import job.
    await engHr.get(`/api/v1/employees/import/${real.id}`).expect(404);

    const exported = await supertest(app)
      .get('/api/v1/employees/export?institutionId=' + eng)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain(code);
    expect(exported.text).not.toContain('ABCDE1111A');
    expect(exported.text.split('\r\n')[0]).toContain('employeeCode');
  });

  it('manages designations and per-institution code numbering', async () => {
    const designation = (
      await groupHr
        .post('/api/v1/designations', {
          code: name('PROF').toUpperCase().slice(0, 30),
          name: 'Professor',
          groupId: (await prisma.institution.findUniqueOrThrow({ where: { id: eng } })).groupId,
          category: 'TEACHING',
          level: 5,
        })
        .expect(201)
    ).body.data;
    // Institution HR may not manage group-level designations, but can see them.
    await engHr.patch(`/api/v1/designations/${designation.id}`, { name: 'X' }).expect(403);
    await engHr.get(`/api/v1/designations/${designation.id}`).expect(200);
    // Organization-wide designations need an organization-wide grant.
    await groupHr
      .post('/api/v1/designations', { code: name('ORG').toUpperCase(), name: 'Org wide' })
      .expect(403);

    const prefix = `E${(seq += 1)}-`;
    // The organization default needs an organization-wide grant; institution HR may number
    // its own institution.
    await engHr
      .put('/api/v1/employees/code-sequences', { institutionId: null, prefix: 'X-', padding: 3 })
      .expect(403);
    await engHr
      .put('/api/v1/employees/code-sequences', {
        institutionId: eng,
        prefix,
        padding: 3,
        nextNumber: 7,
      })
      .expect(200);
    const emp = (await createEmployee(engHr, { institutionId: eng, designationId: designation.id }))
      .data;
    expect(emp.employeeCode).toBe(`${prefix}007`);
    expect(emp.designation).toMatchObject({ id: designation.id });
  });

  it('scopes designations to a department', async () => {
    const dev = (
      await engHr
        .post('/api/v1/designations', {
          code: name('FE').toUpperCase().slice(0, 30),
          name: 'Frontend Developer',
          departmentId: engCse,
        })
        .expect(201)
    ).body.data;
    expect(dev).toMatchObject({ institutionId: eng, departmentId: engCse });
    expect(dev.department).toMatchObject({ id: engCse });
    // A department of another institution cannot be attached.
    await engHr.patch(`/api/v1/designations/${dev.id}`, { departmentId: comCse }).expect(422);
    const forCse = (
      await engHr.get(`/api/v1/designations?departmentId=${engCse}&pageSize=100`).expect(200)
    ).body.data as Array<{ id: string; departmentId: string | null }>;
    expect(forCse.map((d) => d.id)).toContain(dev.id);
    expect(forCse.every((d) => d.departmentId === null || d.departmentId === engCse)).toBe(true);
    const forCom = (
      await engHr.get(`/api/v1/designations?departmentId=${engCom}&pageSize=100`).expect(200)
    ).body.data as Array<{ id: string }>;
    expect(forCom.map((d) => d.id)).not.toContain(dev.id);
  });

  it('manages organization employee types and derives the employment category', async () => {
    const code = name('PERM').toUpperCase().slice(0, 30);
    await engHr
      .post('/api/v1/employee-types', { code, name: 'X', category: 'FULL_TIME' })
      .expect(403);
    const type = (
      await owner
        .post('/api/v1/employee-types', { code, name: 'Permanent', category: 'FULL_TIME' })
        .expect(201)
    ).body.data;
    const emp = (
      await createEmployee(engHr, {
        institutionId: eng,
        employmentType: undefined,
        employeeTypeId: type.id,
      })
    ).data;
    expect(emp).toMatchObject({ employmentType: 'FULL_TIME', employeeTypeId: type.id });
    expect(emp.employeeType).toMatchObject({ id: type.id, name: 'Permanent' });
    const listed = (await engHr.get('/api/v1/employee-types').expect(200)).body.data as Array<{
      id: string;
      employeeCount: number;
    }>;
    expect(listed.find((t) => t.id === type.id)?.employeeCount).toBe(1);
    // In use: category is frozen and the type cannot be deleted.
    await owner.patch(`/api/v1/employee-types/${type.id}`, { category: 'INTERN' }).expect(409);
    await owner.delete(`/api/v1/employee-types/${type.id}`).expect(409);
    // Neither a type nor a category → 400.
    await createEmployee(engHr, { institutionId: eng, employmentType: undefined }, 400);
  });
});

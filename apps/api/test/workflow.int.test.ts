import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { drainJobs, runAsSystem } from '../src/core/queue';
import {
  registerWorkflowEntity,
  submitWorkflow,
  type WorkflowInstanceRef,
} from '../src/core/workflow';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

const ENTITY = 'test_expense_claim';

describe.skipIf(!hasTestDatabase)('workflow engine', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let abbs: string;
  let eng: string;
  let cse: string;
  let userIds: Record<string, string>;
  const approved: WorkflowInstanceRef[] = [];
  const rejected: WorkflowInstanceRef[] = [];
  let definitionId: string;

  const client = (email: string) => signIn(app, email, DEMO_PASSWORD);

  async function submit(requester: string, amount: number, entityId = randomUUID()) {
    const row = await runAsSystem(abbs, () =>
      submitWorkflow({
        entityType: ENTITY,
        entityId,
        title: `Expense claim ${amount}`,
        requesterUserId: userIds[requester]!,
        institutionId: eng,
        departmentId: cse,
        context: { amount },
      }),
    );
    expect(row).not.toBeNull();
    await drainJobs();
    return row!.id;
  }

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    abbs = fixture.orgIds.abbs!;
    userIds = fixture.userIds;
    eng = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: abbs, code: 'ABBS-ENG' },
      })
    ).id;
    cse = (await prisma.department.findFirstOrThrow({ where: { institutionId: eng, code: 'CSE' } }))
      .id;
    registerWorkflowEntity({
      entityType: ENTITY,
      label: 'Test expense claim',
      linkFor: (i) => `/expenses/${i.entityId}`,
      onApproved: async (i) => {
        approved.push(i);
      },
      onRejected: async (i) => {
        rejected.push(i);
      },
    });
    await prisma.workflowDefinition.deleteMany({
      where: { organizationId: abbs, entityType: ENTITY },
    });

    const owner = await client('owner@abbs.test');
    const res = await owner
      .post('/api/v1/workflows/definitions', {
        entityType: ENTITY,
        name: 'Expense approval',
        steps: [
          {
            key: 'institution',
            name: 'Institution admin',
            approvers: [{ type: 'role', roleKey: 'institution_admin' }],
          },
          {
            key: 'owner',
            name: 'Owner (large claims)',
            approvers: [{ type: 'role', roleKey: 'group_owner' }],
            conditions: [{ field: 'amount', op: 'gt', value: 50000 }],
          },
        ],
      })
      .expect(201);
    definitionId = res.body.data.id;
    expect(res.body.data).toMatchObject({ version: 1, status: 'ACTIVE', allowSelfApproval: false });
  });

  afterAll(async () => {
    await drainJobs();
  });

  it('lists registered entity types', async () => {
    const owner = await client('owner@abbs.test');
    const res = await owner.get('/api/v1/workflows/entity-types').expect(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([{ entityType: ENTITY, label: 'Test expense claim' }]),
    );
  });

  it('enforces definition scope: group admin cannot create an organization-wide workflow', async () => {
    const groupAdmin = await client('group.admin@abbs.test');
    await groupAdmin
      .post('/api/v1/workflows/definitions', {
        entityType: ENTITY,
        name: 'Org wide',
        steps: [
          {
            key: 'a',
            name: 'A',
            approvers: [{ type: 'user', userIds: [userIds['owner@abbs.test']!] }],
          },
        ],
      })
      .expect(403);
    const engAdmin = await client('eng.admin@abbs.test');
    await engAdmin
      .post('/api/v1/workflows/definitions', {
        entityType: ENTITY,
        name: 'Nope',
        steps: [{ key: 'a', name: 'A', approvers: [{ type: 'role', roleKey: 'hod' }] }],
      })
      .expect(403);
  });

  it('runs a multi-step approval with role approvers resolved within scope', async () => {
    const id = await submit('cse.hod@abbs.test', 60000);
    const engAdmin = await client('eng.admin@abbs.test');
    const owner = await client('owner@abbs.test');

    const inbox = (await engAdmin.get('/api/v1/workflows/inbox').expect(200)).body.data;
    expect(inbox.map((i: { id: string }) => i.id)).toContain(id);
    // Step 2 is not active yet.
    const ownerInbox = (await owner.get('/api/v1/workflows/inbox').expect(200)).body.data;
    expect(ownerInbox.map((i: { id: string }) => i.id)).not.toContain(id);

    // The approver was notified in-app.
    const notes = await prisma.notification.findMany({
      where: { userId: userIds['eng.admin@abbs.test']!, eventKey: 'workflow.approval_requested' },
    });
    expect(
      notes.some(
        (n) =>
          (n.data as { instanceId?: string } | null)?.instanceId === id || n.link?.includes(id),
      ),
    ).toBe(true);

    // A user outside the approver list cannot decide.
    const groupAdmin = await client('group.admin@abbs.test');
    const denied = await groupAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(403);
    expect(denied.body.error.code).toBe('NOT_AN_APPROVER');

    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve', comment: 'ok' })
      .expect(200);
    const afterFirst = (await owner.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data;
    expect(afterFirst).toMatchObject({ status: 'PENDING', currentStepKey: 'owner' });
    expect(afterFirst.allowedActions).toContain('approve');

    await owner
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(200);
    await drainJobs();
    const done = (await owner.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.steps.map((s: { status: string }) => s.status)).toEqual(['APPROVED', 'APPROVED']);
    expect(done.actions.map((a: { action: string }) => a.action)).toEqual([
      'submit',
      'approve',
      'approve',
    ]);
    expect(approved.map((i) => i.id)).toContain(id);

    // Requester can read the history of their own request; decided -> no more actions.
    const hod = await client('cse.hod@abbs.test');
    const mine = (await hod.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data;
    expect(mine.status).toBe('APPROVED');
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(409);

    const audits = await prisma.auditLog.count({
      where: { organizationId: abbs, entityType: 'workflow_instance', entityId: id },
    });
    expect(audits).toBeGreaterThanOrEqual(3);
  });

  it('skips conditional steps that do not apply', async () => {
    const id = await submit('cse.hod@abbs.test', 100);
    const engAdmin = await client('eng.admin@abbs.test');
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(200);
    const done = (await engAdmin.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.steps.map((s: { status: string }) => s.status)).toEqual(['APPROVED', 'SKIPPED']);
  });

  it('rejects with a mandatory comment and fires onRejected', async () => {
    const id = await submit('cse.hod@abbs.test', 70000);
    const engAdmin = await client('eng.admin@abbs.test');
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'reject' })
      .expect(400);
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, {
        action: 'reject',
        comment: 'Missing receipts',
      })
      .expect(200);
    await drainJobs();
    const row = await prisma.workflowInstance.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('REJECTED');
    expect(rejected.find((i) => i.id === id)?.comment).toBe('Missing receipts');
    // The requester was told.
    const decided = await prisma.notification.count({
      where: { userId: userIds['cse.hod@abbs.test']!, eventKey: 'workflow.decided' },
    });
    expect(decided).toBeGreaterThan(0);
  });

  it('send back -> resubmit -> approve', async () => {
    const id = await submit('cse.hod@abbs.test', 10);
    const engAdmin = await client('eng.admin@abbs.test');
    const hod = await client('cse.hod@abbs.test');
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, {
        action: 'send_back',
        comment: 'Attach the bill',
      })
      .expect(200);
    expect((await hod.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data.status).toBe(
      'SENT_BACK',
    );
    await hod
      .post(`/api/v1/workflows/instances/${id}/resubmit`, { comment: 'Attached' })
      .expect(200);
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(200);
    const done = (await hod.get(`/api/v1/workflows/instances/${id}`).expect(200)).body.data;
    expect(done.status).toBe('APPROVED');
  });

  it('prevents self-approval unless the definition allows it', async () => {
    const id = await submit('eng.admin@abbs.test', 10);
    const engAdmin = await client('eng.admin@abbs.test');
    const res = await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    await engAdmin.post(`/api/v1/workflows/instances/${id}/cancel`, {}).expect(200);
  });

  it('versions definitions: a revision supersedes the active version', async () => {
    const owner = await client('owner@abbs.test');
    const res = await owner
      .post(`/api/v1/workflows/definitions/${definitionId}/revisions`, {
        name: 'Expense approval v2',
        allowSelfApproval: true,
        steps: [
          {
            key: 'institution',
            name: 'Institution admin',
            approvers: [{ type: 'role', roleKey: 'institution_admin' }],
          },
        ],
      })
      .expect(201);
    expect(res.body.data).toMatchObject({ version: 2, status: 'ACTIVE', allowSelfApproval: true });
    const versions = (
      await owner.get(`/api/v1/workflows/definitions/${res.body.data.id}/versions`).expect(200)
    ).body.data;
    expect(versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual(
      expect.arrayContaining([
        [1, 'ARCHIVED'],
        [2, 'ACTIVE'],
      ]),
    );
    // Self approval now allowed.
    const id = await submit('eng.admin@abbs.test', 10);
    const engAdmin = await client('eng.admin@abbs.test');
    await engAdmin
      .post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' })
      .expect(200);
  });

  it('isolates instances between tenants', async () => {
    const id = await submit('cse.hod@abbs.test', 10);
    const bcc = await client('admin@bcc.test');
    await bcc.get(`/api/v1/workflows/instances/${id}`).expect(404);
    await bcc.post(`/api/v1/workflows/instances/${id}/actions`, { action: 'approve' }).expect(404);
    const inbox = (await bcc.get('/api/v1/workflows/inbox').expect(200)).body.data;
    expect(inbox.map((i: { id: string }) => i.id)).not.toContain(id);
  });
});

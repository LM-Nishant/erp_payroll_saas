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

interface Named {
  id: string;
  code: string;
  name: string;
  organizationId: string;
  institutionId?: string;
}

const codes = (rows: Named[]) => rows.map((r) => r.code).sort();

describe.skipIf(!hasTestDatabase)('RBAC + scope authorization', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;
  let groupAdmin: Awaited<ReturnType<typeof signIn>>;
  let engAdmin: Awaited<ReturnType<typeof signIn>>;
  let hod: Awaited<ReturnType<typeof signIn>>;
  let bccAdmin: Awaited<ReturnType<typeof signIn>>;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let abbsInstitutions: Named[];

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
    groupAdmin = await signIn(app, 'group.admin@abbs.test', DEMO_PASSWORD);
    engAdmin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    hod = await signIn(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    abbsInstitutions = (await owner.get('/api/v1/institutions').expect(200)).body.data;
  });

  afterAll(() => prisma.$disconnect());

  const byCode = (code: string) => abbsInstitutions.find((i) => i.code === code)!;

  it('ABBS Group Admin sees all 4 ABBS colleges', async () => {
    const res = await groupAdmin.get('/api/v1/institutions').expect(200);
    expect(res.body.meta.total).toBe(4);
    expect(codes(res.body.data)).toEqual(['ABBS-ART', 'ABBS-COM', 'ABBS-ENG', 'ABBS-MGT']);
    const departments = await groupAdmin.get('/api/v1/departments?pageSize=100').expect(200);
    expect(departments.body.meta.total).toBe(8);
  });

  it('BCC admin cannot see ABBS data', async () => {
    const res = await bccAdmin.get('/api/v1/institutions').expect(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.every((i: Named) => i.organizationId === orgIds.bcc)).toBe(true);
    await bccAdmin.get(`/api/v1/institutions/${byCode('ABBS-ENG').id}`).expect(404);
  });

  it('Institution admin is limited to the assigned institution', async () => {
    const res = await engAdmin.get('/api/v1/institutions').expect(200);
    expect(codes(res.body.data)).toEqual(['ABBS-ENG']);
    await engAdmin.get(`/api/v1/institutions/${byCode('ABBS-ENG').id}`).expect(200);
    await engAdmin.get(`/api/v1/institutions/${byCode('ABBS-COM').id}`).expect(404);

    const departments = await engAdmin.get('/api/v1/departments').expect(200);
    expect(departments.body.meta.total).toBe(2);
    expect(
      departments.body.data.every((d: Named) => d.institutionId === byCode('ABBS-ENG').id),
    ).toBe(true);

    const campuses = await engAdmin.get('/api/v1/campuses').expect(200);
    const comCampus = (await owner.get('/api/v1/campuses?pageSize=100')).body.data.find(
      (c: Named) => c.institutionId === byCode('ABBS-COM').id,
    );
    expect(campuses.body.meta.total).toBe(1);

    // Writes outside the scope are denied; inside are allowed and audited.
    await engAdmin
      .post('/api/v1/departments', {
        institutionId: byCode('ABBS-COM').id,
        campusId: comCampus.id,
        code: 'X1',
        name: 'Nope',
      })
      .expect(403);
    const created = await engAdmin
      .post('/api/v1/departments', {
        institutionId: byCode('ABBS-ENG').id,
        campusId: campuses.body.data[0].id,
        code: `EE${Date.now() % 10000}`,
        name: 'Electrical',
      })
      .expect(201);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'department.create', entityId: created.body.data.id },
    });
    expect(audit).toMatchObject({ organizationId: orgIds.abbs, entityType: 'department' });

    // Institution admins cannot create institutions or touch groups.
    await engAdmin.post('/api/v1/institutions', { code: 'NEW', name: 'New' }).expect(403);
    await engAdmin
      .patch(`/api/v1/institutions/${byCode('ABBS-COM').id}`, { name: 'x' })
      .expect(404);
  });

  it('HOD only sees assigned departments', async () => {
    const departments = await hod.get('/api/v1/departments').expect(200);
    expect(departments.body.meta.total).toBe(1);
    expect(departments.body.data[0]).toMatchObject({
      code: 'CSE',
      institutionId: byCode('ABBS-ENG').id,
    });
    const institutions = await hod.get('/api/v1/institutions').expect(200);
    expect(institutions.body.meta.total).toBe(0);
    await hod
      .post('/api/v1/departments', { institutionId: byCode('ABBS-ENG').id, code: 'Z', name: 'Z' })
      .expect(403);
  });

  it('routes without the permission return 403', async () => {
    const res = await hod.get('/api/v1/roles').expect(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('/me lists permissions and scopes for the menu', async () => {
    const me = (await groupAdmin.get('/api/v1/me').expect(200)).body.data;
    expect(me.permissions).toEqual(expect.arrayContaining(['institution.create', 'user.view']));
    expect(me.permissions).not.toContain('role.manage');
    expect(me.roles[0].scopes[0]).toMatchObject({ type: 'GROUP', name: 'ABBS Group' });
  });

  describe('user management', () => {
    let roleIds: Record<string, string>;

    beforeAll(async () => {
      const roles = (await owner.get('/api/v1/roles?pageSize=100').expect(200)).body.data;
      roleIds = Object.fromEntries(roles.map((r: { key: string; id: string }) => [r.key, r.id]));
    });

    it('scoped admins only list users within their scopes', async () => {
      const all = await owner.get('/api/v1/users?pageSize=100').expect(200);
      const emails = all.body.data.map((u: { email: string }) => u.email);
      expect(emails).toEqual(
        expect.arrayContaining(['group.admin@abbs.test', 'cse.hod@abbs.test']),
      );

      const scoped = await engAdmin.get('/api/v1/users?pageSize=100').expect(200);
      const scopedEmails = scoped.body.data.map((u: { email: string }) => u.email);
      expect(scopedEmails).toEqual(
        expect.arrayContaining(['eng.admin@abbs.test', 'cse.hod@abbs.test']),
      );
      expect(scopedEmails).not.toContain('group.admin@abbs.test');
      expect(scopedEmails).not.toContain('owner@abbs.test');

      const search = await owner.get('/api/v1/users?search=hod').expect(200);
      expect(search.body.data.map((u: { email: string }) => u.email)).toEqual([
        'cse.hod@abbs.test',
      ]);
    });

    it('institution admin can assign roles within the institution but cannot escalate', async () => {
      const eng = byCode('ABBS-ENG').id;
      const created = await engAdmin
        .post('/api/v1/users', {
          email: `teacher-${Date.now()}@abbs.test`,
          name: 'ENG Teacher',
          password: 'Teacher-Passw0rd!',
          roles: [{ roleId: roleIds.teacher, scopes: [{ type: 'INSTITUTION', id: eng }] }],
        })
        .expect(201);
      const userId = created.body.data.id;
      expect(created.body.data.roles[0].scopes[0]).toMatchObject({ type: 'INSTITUTION', id: eng });

      // Outside own institution.
      await engAdmin
        .put(`/api/v1/users/${userId}/roles`, {
          roles: [
            {
              roleId: roleIds.teacher,
              scopes: [{ type: 'INSTITUTION', id: byCode('ABBS-COM').id }],
            },
          ],
        })
        .expect(403);
      // Role with permissions the admin does not hold (escalation).
      const escalate = await engAdmin
        .put(`/api/v1/users/${userId}/roles`, {
          roles: [{ roleId: roleIds.group_owner, scopes: [{ type: 'INSTITUTION', id: eng }] }],
        })
        .expect(403);
      expect(escalate.body.error.code).toBe('ESCALATION_DENIED');
      // Org-wide scope.
      await engAdmin
        .put(`/api/v1/users/${userId}/roles`, {
          roles: [{ roleId: roleIds.teacher, scopes: [{ type: 'ORGANIZATION' }] }],
        })
        .expect(403);

      // Valid replacement (transactional) is audited.
      const hodRole = await engAdmin
        .put(`/api/v1/users/${userId}/roles`, {
          roles: [{ roleId: roleIds.hod, scopes: [{ type: 'INSTITUTION', id: eng }] }],
        })
        .expect(200);
      expect(hodRole.body.data.roles.map((r: { key: string }) => r.key)).toEqual(['hod']);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'user.role.assign', entityId: userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();

      // Cannot manage users outside the scope.
      const groupAdminId = (await groupAdmin.get('/api/v1/me')).body.data.user.id;
      await engAdmin.post(`/api/v1/users/${groupAdminId}/deactivate`).expect(404);
    });

    it('scope assignments must reference hierarchy entities of the tenant', async () => {
      const bccInstitution = (await bccAdmin.get('/api/v1/institutions')).body.data[0];
      const res = await owner.post('/api/v1/users', {
        email: `cross-${Date.now()}@abbs.test`,
        name: 'Cross',
        roles: [
          { roleId: roleIds.teacher, scopes: [{ type: 'INSTITUTION', id: bccInstitution.id }] },
        ],
      });
      expect([404, 422]).toContain(res.status);
    });

    it('custom roles: only permissions the editor holds; system roles read-only', async () => {
      const custom = await owner
        .post('/api/v1/roles', {
          key: `exam_cell_${Date.now() % 100000}`,
          name: 'Exam cell',
          permissions: ['student.view', 'document.view'],
        })
        .expect(201);
      expect(custom.body.data.permissions).toEqual(['document.view', 'student.view']);
      await owner
        .post('/api/v1/roles', {
          key: 'bad_role',
          name: 'Bad',
          permissions: ['platform.tenant.access'],
        })
        .expect(422);
      await owner.patch(`/api/v1/roles/${roleIds.teacher}`, { name: 'Renamed' }).expect(409);
      await groupAdmin
        .post('/api/v1/roles', { key: 'ga_role', name: 'GA', permissions: ['student.view'] })
        .expect(403);
      await owner.delete(`/api/v1/roles/${custom.body.data.id}`).expect(204);
      const perms = await owner.get('/api/v1/permissions').expect(200);
      expect(perms.body.meta.total).toBeGreaterThan(20);
    });
  });
});

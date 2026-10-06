import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData } from '../prisma/seed-data';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { asTenant, hasTestDatabase } from './helpers';

interface Row {
  id: string;
  organizationId: string;
  groupId?: string | null;
  institutionId?: string;
  name: string;
}

describe.skipIf(!hasTestDatabase)('tenant isolation over HTTP', () => {
  const app = createApp();
  const abbs = asTenant(app, 'abbs');
  const bcc = asTenant(app, 'bcc');
  const jp = asTenant(app, 'jp-college');
  let orgIds: Record<string, string>;
  let bccInstitution: Row;
  let bccGroupId: string;
  let jpInstitution: Row;

  beforeAll(async () => {
    orgIds = await seedDemoData(prisma);
    const bccList = await bcc.get('/api/v1/institutions').expect(200);
    bccInstitution = bccList.body.data[0];
    bccGroupId = (await bcc.get('/api/v1/groups').expect(200)).body.data[0].id;
    jpInstitution = (await jp.get('/api/v1/institutions').expect(200)).body.data[0];
  });

  afterAll(() => prisma.$disconnect());

  it('each tenant sees only its own institutions', async () => {
    const abbsList = await abbs.get('/api/v1/institutions').expect(200);
    expect(abbsList.body.meta.total).toBe(4);
    expect(abbsList.body.data.every((i: Row) => i.organizationId === orgIds.abbs)).toBe(true);

    const bccList = await bcc.get('/api/v1/institutions').expect(200);
    expect(bccList.body.meta.total).toBe(2);
    expect(bccList.body.data.every((i: Row) => i.organizationId === orgIds.bcc)).toBe(true);
  });

  it('JP College operates independently without a group', async () => {
    const institutions = await jp.get('/api/v1/institutions').expect(200);
    expect(institutions.body.meta.total).toBe(1);
    expect(institutions.body.data[0]).toMatchObject({ name: 'JP College', groupId: null });

    const groups = await jp.get('/api/v1/groups').expect(200);
    expect(groups.body.meta.total).toBe(0);

    const independent = await jp.get('/api/v1/institutions?independent=true').expect(200);
    expect(independent.body.meta.total).toBe(1);

    const created = await jp
      .post('/api/v1/departments', {
        institutionId: jpInstitution.id,
        code: 'PHY',
        name: 'Physics',
      })
      .expect(201);
    expect(created.body.data.organizationId).toBe(orgIds['jp-college']);

    const abbsView = await abbs.get(`/api/v1/departments/${created.body.data.id}`);
    expect(abbsView.status).toBe(404);
  });

  it('ABBS cannot read BCC or JP records by id', async () => {
    await abbs.get(`/api/v1/institutions/${bccInstitution.id}`).expect(404);
    await abbs.get(`/api/v1/institutions/${jpInstitution.id}`).expect(404);
    await abbs.get(`/api/v1/groups/${bccGroupId}`).expect(404);
  });

  it('list filters cannot be used to reach another tenant', async () => {
    const res = await abbs.get(`/api/v1/campuses?institutionId=${bccInstitution.id}`).expect(200);
    expect(res.body.meta.total).toBe(0);
    const groupFilter = await abbs.get(`/api/v1/institutions?groupId=${bccGroupId}`).expect(200);
    expect(groupFilter.body.meta.total).toBe(0);
  });

  it('ABBS cannot update or delete BCC/JP records', async () => {
    await abbs.patch(`/api/v1/institutions/${bccInstitution.id}`, { name: 'Hijacked' }).expect(404);
    await abbs.delete(`/api/v1/institutions/${jpInstitution.id}`).expect(404);

    const untouched = await prisma.institution.findUniqueOrThrow({
      where: { id: bccInstitution.id },
    });
    expect(untouched.name).toBe(bccInstitution.name);
    expect(untouched.deletedAt).toBeNull();
    const jpUntouched = await prisma.institution.findUniqueOrThrow({
      where: { id: jpInstitution.id },
    });
    expect(jpUntouched.deletedAt).toBeNull();
  });

  it('ABBS cannot attach children to BCC/JP parents', async () => {
    const campus = await abbs
      .post('/api/v1/campuses', { institutionId: bccInstitution.id, code: 'X', name: 'Evil' })
      .expect(422);
    expect(campus.body.error.code).toBe('INVALID_REFERENCE');

    await abbs
      .post('/api/v1/institutions', { groupId: bccGroupId, code: 'EVIL', name: 'Evil College' })
      .expect(422);

    await abbs
      .post('/api/v1/departments', { institutionId: jpInstitution.id, code: 'X', name: 'Evil' })
      .expect(422);

    const bccDept = (await bcc.get('/api/v1/departments').expect(200)).body.data[0];
    await abbs
      .post('/api/v1/programs', { departmentId: bccDept.id, code: 'X', name: 'X' })
      .expect(422);

    const bccProgram = (await bcc.get('/api/v1/programs').expect(200)).body.data[0];
    await abbs
      .post('/api/v1/class-sections', { programId: bccProgram.id, code: 'X', name: 'X' })
      .expect(422);
  });

  it('rejects client-supplied tenant identifiers in body and query', async () => {
    const body = await abbs
      .post('/api/v1/groups', { name: 'Sneaky', code: 'SNK', organizationId: orgIds.bcc })
      .expect(400);
    expect(body.body.error.code).toBe('VALIDATION_ERROR');

    await abbs.get(`/api/v1/institutions?organizationId=${orgIds.bcc}`).expect(400);
    await abbs.get(`/api/v1/institutions?tenant_id=${orgIds.bcc}`).expect(400);

    const count = await prisma.group.count({ where: { code: 'SNK' } });
    expect(count).toBe(0);
  });

  it('requires a server-resolved tenant', async () => {
    const res = await asTenant(app, 'does-not-exist').get('/api/v1/groups').expect(401);
    expect(res.body.error.code).toBe('TENANT_UNRESOLVED');
  });

  it('rejects suspended organizations', async () => {
    const org = await prisma.organization.create({
      data: { slug: 'suspended-org', name: 'Suspended', status: 'SUSPENDED' },
    });
    const res = await asTenant(app, org.slug).get('/api/v1/groups').expect(403);
    expect(res.body.error.code).toBe('TENANT_INACTIVE');
  });

  it('returns only the current organization', async () => {
    const res = await jp.get('/api/v1/organization').expect(200);
    expect(res.body.data).toMatchObject({ id: orgIds['jp-college'], slug: 'jp-college' });
  });
});

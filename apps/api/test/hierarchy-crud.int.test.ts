import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { asTenant, hasTestDatabase } from './helpers';

describe.skipIf(!hasTestDatabase)('hierarchy CRUD', () => {
  const app = createApp();
  const t = asTenant(app, 'crud-org');

  beforeAll(async () => {
    await prisma.organization.upsert({
      where: { slug: 'crud-org' },
      create: { slug: 'crud-org', name: 'CRUD Org' },
      update: {},
    });
  });
  afterAll(() => prisma.$disconnect());

  it('creates, reads, updates and soft-deletes the full hierarchy', async () => {
    const group = (await t.post('/api/v1/groups', { name: 'Test Group', code: 'TG' }).expect(201))
      .body.data;
    expect(group).toMatchObject({ code: 'TG', status: 'ACTIVE', deletedAt: null });

    const institution = (
      await t
        .post('/api/v1/institutions', {
          groupId: group.id,
          name: 'Test College',
          code: 'TC',
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
          name: 'Mathematics',
          code: 'MATH',
        })
        .expect(201)
    ).body.data;

    const program = (
      await t
        .post('/api/v1/programs', {
          departmentId: department.id,
          name: 'B.Sc Mathematics',
          code: 'BSC-MATH',
          durationMonths: 36,
        })
        .expect(201)
    ).body.data;
    expect(program.institutionId).toBe(institution.id);

    const section = (
      await t
        .post('/api/v1/class-sections', {
          programId: program.id,
          campusId: campus.id,
          name: 'Section A',
          code: 'A',
          academicYear: '2025-26',
        })
        .expect(201)
    ).body.data;
    expect(section).toMatchObject({
      institutionId: institution.id,
      departmentId: department.id,
      programId: program.id,
    });

    // Reads & filters
    const list = await t.get(`/api/v1/class-sections?programId=${program.id}`).expect(200);
    expect(list.body.meta.total).toBe(1);
    await t.get(`/api/v1/programs/${program.id}`).expect(200);

    // Update
    const renamed = await t.patch(`/api/v1/groups/${group.id}`, { name: 'Renamed' }).expect(200);
    expect(renamed.body.data.name).toBe('Renamed');

    // Duplicate code → 409
    await t.post('/api/v1/groups', { name: 'Dup', code: 'TG' }).expect(409);

    // Cannot delete a parent with children
    await t.delete(`/api/v1/programs/${program.id}`).expect(409);
    await t.delete(`/api/v1/groups/${group.id}`).expect(409);

    // Soft delete bottom-up
    await t.delete(`/api/v1/class-sections/${section.id}`).expect(204);
    await t.get(`/api/v1/class-sections/${section.id}`).expect(404);
    const raw = await prisma.classSection.findUniqueOrThrow({ where: { id: section.id } });
    expect(raw.deletedAt).not.toBeNull();
    await t.delete(`/api/v1/programs/${program.id}`).expect(204);
  });

  it('validates campus belongs to the same institution', async () => {
    const a = (await t.post('/api/v1/institutions', { name: 'Inst A', code: 'IA' }).expect(201))
      .body.data;
    const b = (await t.post('/api/v1/institutions', { name: 'Inst B', code: 'IB' }).expect(201))
      .body.data;
    const campusB = (
      await t.post('/api/v1/campuses', { institutionId: b.id, name: 'B', code: 'B' }).expect(201)
    ).body.data;
    const res = await t
      .post('/api/v1/departments', {
        institutionId: a.id,
        campusId: campusB.id,
        name: 'X',
        code: 'X',
      })
      .expect(422);
    expect(res.body.error.details).toEqual({ field: 'campusId' });
  });

  it('returns 400 for invalid payloads and ids', async () => {
    const res = await t.post('/api/v1/groups', { name: '' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    await t.get('/api/v1/groups/not-a-uuid').expect(400);
  });
});

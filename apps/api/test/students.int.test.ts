import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { asTenant, hasTestDatabase } from './helpers';

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

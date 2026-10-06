import type { PrismaClient } from '@prisma/client';
import { currentOrganizationId, runWithTenant, tenantDb } from '../src/core/tenancy';

/*
 * Demo hierarchy:
 *   ABBS Education (org) → ABBS Group → 4 colleges
 *   BCC Education  (org) → BCC Group  → 2 colleges
 *   JP College     (org) → independent institution (no group)
 * Idempotent: safe to run repeatedly.
 */

interface CollegeSeed {
  code: string;
  name: string;
  departments: Array<{ code: string; name: string; program: { code: string; name: string } }>;
}

interface OrgSeed {
  slug: string;
  name: string;
  group?: { code: string; name: string };
  colleges: CollegeSeed[];
}

const standardDepartments = (prefix: string): CollegeSeed['departments'] => [
  {
    code: 'CSE',
    name: 'Computer Science',
    program: { code: `${prefix}-BSC-CS`, name: 'B.Sc Computer Science' },
  },
  {
    code: 'COM',
    name: 'Commerce',
    program: { code: `${prefix}-BCOM`, name: 'B.Com' },
  },
];

const college = (code: string, name: string): CollegeSeed => ({
  code,
  name,
  departments: standardDepartments(code),
});

export const DEMO_ORGANIZATIONS: OrgSeed[] = [
  {
    slug: 'abbs',
    name: 'ABBS Education',
    group: { code: 'ABBS', name: 'ABBS Group' },
    colleges: [
      college('ABBS-ENG', 'ABBS College of Engineering'),
      college('ABBS-COM', 'ABBS College of Commerce'),
      college('ABBS-ART', 'ABBS College of Arts & Science'),
      college('ABBS-MGT', 'ABBS School of Management'),
    ],
  },
  {
    slug: 'bcc',
    name: 'BCC Education',
    group: { code: 'BCC', name: 'BCC Group' },
    colleges: [college('BCC-A', 'BCC College A'), college('BCC-B', 'BCC College B')],
  },
  {
    slug: 'jp-college',
    name: 'JP College',
    colleges: [college('JPC', 'JP College')],
  },
];

export const ACADEMIC_YEAR = '2025-26';

async function seedOrganizationHierarchy(spec: OrgSeed): Promise<void> {
  const db = tenantDb();
  const orgId = currentOrganizationId();
  const group = spec.group
    ? await db.group.upsert({
        where: { organizationId_code: { organizationId: orgId, code: spec.group.code } },
        create: { organizationId: orgId, code: spec.group.code, name: spec.group.name },
        update: { name: spec.group.name },
      })
    : null;

  for (const c of spec.colleges) {
    const institution = await db.institution.upsert({
      where: { organizationId_code: { organizationId: orgId, code: c.code } },
      create: {
        organizationId: orgId,
        code: c.code,
        name: c.name,
        type: 'COLLEGE',
        groupId: group?.id ?? null,
      },
      update: { name: c.name, groupId: group?.id ?? null },
    });
    const ids = { organizationId: orgId, institutionId: institution.id };
    const campus = await db.campus.upsert({
      where: { institutionId_code: { institutionId: institution.id, code: 'MAIN' } },
      create: { ...ids, code: 'MAIN', name: `${c.name} - Main Campus`, isMain: true },
      update: {},
    });
    for (const d of c.departments) {
      const department = await db.department.upsert({
        where: { institutionId_code: { institutionId: institution.id, code: d.code } },
        create: { ...ids, campusId: campus.id, code: d.code, name: d.name },
        update: { name: d.name },
      });
      const program = await db.program.upsert({
        where: { institutionId_code: { institutionId: institution.id, code: d.program.code } },
        create: {
          ...ids,
          departmentId: department.id,
          code: d.program.code,
          name: d.program.name,
          level: 'UNDERGRADUATE',
          durationMonths: 36,
        },
        update: { name: d.program.name },
      });
      await db.classSection.upsert({
        where: {
          programId_code_academicYear: {
            programId: program.id,
            code: 'A',
            academicYear: ACADEMIC_YEAR,
          },
        },
        create: {
          ...ids,
          departmentId: department.id,
          programId: program.id,
          campusId: campus.id,
          code: 'A',
          name: `${d.program.name} ${ACADEMIC_YEAR} - Section A`,
          academicYear: ACADEMIC_YEAR,
          capacity: 60,
        },
        update: {},
      });
    }
  }
}

export async function seedDemoData(prisma: PrismaClient): Promise<Record<string, string>> {
  const organizationIds: Record<string, string> = {};
  for (const spec of DEMO_ORGANIZATIONS) {
    // Organizations are platform-level records, created with the base client.
    const org = await prisma.organization.upsert({
      where: { slug: spec.slug },
      create: { slug: spec.slug, name: spec.name },
      update: { name: spec.name },
    });
    organizationIds[spec.slug] = org.id;
    // Everything below the tenant root goes through the tenant-scoped client.
    await runWithTenant({ organizationId: org.id, source: 'system' }, () =>
      seedOrganizationHierarchy(spec),
    );
  }
  return organizationIds;
}

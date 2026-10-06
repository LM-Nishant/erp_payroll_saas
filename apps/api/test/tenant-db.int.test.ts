import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData } from '../prisma/seed-data';
import { prisma } from '../src/core/db/prisma';
import { TenantIsolationError, runWithTenant, tenantDb, withTenant } from '../src/core/tenancy';
import { hasTestDatabase } from './helpers';

describe.skipIf(!hasTestDatabase)('tenantDb() Prisma extension against MySQL', () => {
  let orgIds: Record<string, string>;
  const as = <T>(slug: string, fn: () => Promise<T>) =>
    runWithTenant({ organizationId: orgIds[slug]!, source: 'system' }, fn);

  beforeAll(async () => {
    orgIds = await seedDemoData(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('scopes reads, counts and aggregates to the current organization', async () => {
    const total = await prisma.institution.count({ where: { deletedAt: null } });
    const abbsCount = await as('abbs', () => tenantDb().institution.count());
    expect(total).toBeGreaterThan(abbsCount);
    expect(abbsCount).toBeGreaterThanOrEqual(4);

    const groups = await as('abbs', () => tenantDb().group.findMany());
    expect(groups.map((g) => g.code)).toEqual(['ABBS']);
  });

  it('bulk updates never touch other tenants', async () => {
    const before = await prisma.institution.findMany({
      where: { organizationId: orgIds.bcc },
      select: { id: true, phone: true },
    });
    const result = await as('abbs', () =>
      tenantDb().institution.updateMany({ data: { phone: '+91-000' } }),
    );
    expect(result.count).toBeGreaterThanOrEqual(4);
    const after = await prisma.institution.findMany({
      where: { organizationId: orgIds.bcc },
      select: { id: true, phone: true },
    });
    expect(after).toEqual(before);
  });

  it('rejects creating rows in another tenant', async () => {
    await expect(
      as('abbs', () =>
        tenantDb().group.create({
          data: { organizationId: orgIds.bcc!, code: 'X', name: 'X' },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('rejects filtering by another organization id', async () => {
    await expect(
      as('abbs', () => tenantDb().group.findMany({ where: { organizationId: orgIds.bcc! } })),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('rejects nested relation writes', async () => {
    await expect(
      as('abbs', () =>
        tenantDb().group.create({
          data: withTenant({
            code: 'NEST',
            name: 'Nested',
            institutions: { create: [{ organizationId: orgIds.bcc!, code: 'N', name: 'N' }] },
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('hides soft-deleted rows', async () => {
    const created = await as('jp-college', () =>
      tenantDb().group.create({ data: withTenant({ code: 'TMP', name: 'Temp' }) }),
    );
    await as('jp-college', () =>
      tenantDb().group.update({ where: { id: created.id }, data: { deletedAt: new Date() } }),
    );
    const found = await as('jp-college', () =>
      tenantDb().group.findUnique({ where: { id: created.id } }),
    );
    expect(found).toBeNull();
  });

  it('blocks raw SQL and organization writes through the tenant client', async () => {
    await expect(as('abbs', () => tenantDb().$queryRaw`SELECT 1`)).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expect(
      as('abbs', () =>
        tenantDb().organization.update({ where: { id: orgIds.abbs! }, data: { name: 'x' } }),
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    const orgs = await as('abbs', () => tenantDb().organization.findMany());
    expect(orgs.map((o) => o.slug)).toEqual(['abbs']);
  });
});

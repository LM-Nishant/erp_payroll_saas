import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;
const PARENT = 'dash.parent@abbs.test';
const URL = '/api/v1/dashboard/overview?from=2026-10-01&to=2026-10-07';

describe.skipIf(!hasTestDatabase)('dashboard overview', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let owner: Client;
  let groupHr: Client;
  let parent: Client;

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    await syncPlanCatalog();
    await provisionOrganizationSubscription(fixture.orgIds.abbs!, 'enterprise');
    const { seedAccessControl } = await import('../prisma/seed-access');
    await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: PARENT,
          name: 'Dash Parent',
          organization: 'abbs',
          role: 'parent',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
      ],
    });
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    groupHr = await signIn(app, 'group.hr@abbs.test', DEMO_PASSWORD);
    parent = await signIn(app, PARENT, DEMO_PASSWORD);
  });
  afterAll(() => prisma.$disconnect());

  it('returns every section for an organization-wide owner', async () => {
    const d = (await owner.get(URL).expect(200)).body.data;
    expect(d.range).toEqual({ from: '2026-10-01', to: '2026-10-07', days: 7 });
    for (const key of [
      'fees',
      'expenses',
      'payroll',
      'cashFlow',
      'students',
      'employees',
      'hostel',
      'transport',
    ]) {
      expect(d).toHaveProperty(key);
    }
    expect(d.trend).toHaveLength(7);
    expect(d.cashFlow.net).toBe(
      Math.round((d.fees.netCollected - d.expenses.total - d.payroll.paid) * 100) / 100,
    );
    expect(d.employees.attendance).toBeDefined();
    expect(d.students.attendance).toBeDefined();
  });

  it('limits sections to the caller permissions', async () => {
    const d = (await groupHr.get(URL).expect(200)).body.data;
    expect(d.employees).toBeDefined();
    expect(d.fees).toBeUndefined();
    expect(d.expenses).toBeUndefined();
    expect(d.cashFlow).toBeUndefined();
    expect(d.students).toBeUndefined();
  });

  it('gives portal users an empty overview', async () => {
    const d = (await parent.get(URL).expect(200)).body.data;
    expect(Object.keys(d).sort()).toEqual(['institutionId', 'range']);
  });

  it('omits the trend for long ranges', async () => {
    const d = (
      await owner.get('/api/v1/dashboard/overview?from=2026-01-01&to=2026-06-30').expect(200)
    ).body.data;
    expect(d.trend).toBeUndefined();
    expect(d.range.days).toBe(181);
  });

  it('validates the query', async () => {
    await owner.get('/api/v1/dashboard/overview?from=2026-10-08&to=2026-10-01').expect(400);
    await owner.get('/api/v1/dashboard/overview?from=2025-01-01&to=2026-10-01').expect(400);
    await owner.get(`${URL}&organizationId=x`).expect(400);
    await owner.get(`${URL}&institutionId=00000000-0000-4000-8000-000000000000`).expect(422);
  });
});

import { COMPANY_EMPLOYMENT_TYPES } from '@erp/shared';
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

/*
 * Backend pagination of list endpoints that used to return unpaged arrays. Each one keeps its
 * full-list default (pickers) and pages when page/pageSize are sent: a page must be the matching
 * slice of the full, deterministically ordered list and meta.total must count the same filter.
 */

type Client = Awaited<ReturnType<typeof signIn>>;
type Row = { id: string };
type ListBody = { data: Row[]; meta: { page: number; pageSize: number; total: number } };

describe.skipIf(!hasTestDatabase)('backend pagination of list endpoints', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  let abbs: string;
  let eng: string;
  let owner: Client;
  const created = { leaveTypes: [] as string[], policies: [] as string[], locks: [] as string[] };
  const lateRules: string[] = [];

  beforeAll(async () => {
    const { orgIds } = await seedAccessFixture();
    abbs = orgIds.abbs!;
    eng = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: abbs, code: 'ABBS-ENG' },
      })
    ).id;
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
  });
  afterAll(async () => {
    await prisma.attendancePeriodLock.deleteMany({ where: { id: { in: created.locks } } });
    await prisma.leavePolicy.deleteMany({ where: { id: { in: created.policies } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: created.leaveTypes } } });
    await prisma.feeLateRule.deleteMany({ where: { id: { in: lateRules } } });
    await prisma.$disconnect();
  });

  /** Full list (unpaged default) vs. pages of 2: every page is the matching slice. */
  async function expectPagesMatch(client: Client, path: string, full: Row[]) {
    const sep = path.includes('?') ? '&' : '?';
    expect(full.length).toBeGreaterThanOrEqual(3);
    const p1 = (await client.get(`${path}${sep}page=1&pageSize=2`).expect(200)).body as ListBody;
    const p2 = (await client.get(`${path}${sep}page=2&pageSize=2`).expect(200)).body as ListBody;
    expect(p1.meta).toEqual({ page: 1, pageSize: 2, total: full.length });
    expect(p2.meta).toEqual({ page: 2, pageSize: 2, total: full.length });
    expect(p1.data.map((r) => r.id)).toEqual(full.slice(0, 2).map((r) => r.id));
    expect(p2.data.map((r) => r.id)).toEqual(full.slice(2, 4).map((r) => r.id));
    const last = Math.ceil(full.length / 2) + 1;
    const beyond = (await client.get(`${path}${sep}page=${last}&pageSize=2`).expect(200))
      .body as ListBody;
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.total).toBe(full.length);
  }

  it('pages platform plans (full list by default)', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const all = (await platform.get('/api/v1/platform/plans').expect(200)).body as ListBody;
    expect(all.meta).toMatchObject({ page: 1, total: all.data.length });
    expect(all.data.length).toBe(await prisma.subscriptionPlan.count());
    await expectPagesMatch(platform, '/api/v1/platform/plans', all.data);
    await platform.get('/api/v1/platform/plans?pageSize=101').expect(400);
  });

  it('pages leave types and leave policies', async () => {
    for (const n of [1, 2, 3]) {
      const t = (
        await owner
          .post('/api/v1/leave/types', { code: `P${tag}${n}`, name: `Paging type ${tag} ${n}` })
          .expect(201)
      ).body.data;
      created.leaveTypes.push(t.id);
      const p = (
        await owner
          .post('/api/v1/leave/policies', {
            name: `Paging policy ${tag} ${n}`,
            institutionId: eng,
            employmentType: COMPANY_EMPLOYMENT_TYPES[n],
          })
          .expect(201)
      ).body.data;
      created.policies.push(p.id);
    }
    const types = (await owner.get('/api/v1/leave/types').expect(200)).body as ListBody;
    expect(types.meta.total).toBe(types.data.length);
    expect(types.data.map((t) => t.id)).toEqual(expect.arrayContaining(created.leaveTypes));
    await expectPagesMatch(owner, '/api/v1/leave/types', types.data);
    const withInactive = (await owner.get('/api/v1/leave/types?includeInactive=true').expect(200))
      .body as ListBody;
    await expectPagesMatch(owner, '/api/v1/leave/types?includeInactive=true', withInactive.data);

    const policies = (await owner.get('/api/v1/leave/policies').expect(200)).body as ListBody;
    expect(policies.meta.total).toBe(policies.data.length);
    await expectPagesMatch(owner, '/api/v1/leave/policies', policies.data);
  });

  it('pages fee late-rules within the institution filter', async () => {
    for (const n of [1, 2, 3]) {
      const r = (
        await owner
          .post('/api/v1/fees/late-rules', {
            institutionId: eng,
            name: `Paging rule ${tag} ${n}`,
            mode: 'FLAT',
            amount: 10 * n,
          })
          .expect(201)
      ).body.data;
      lateRules.push(r.id);
    }
    const path = `/api/v1/fees/late-rules?institutionId=${eng}`;
    const all = (await owner.get(path).expect(200)).body as ListBody;
    expect(all.data.map((r) => r.id)).toEqual(expect.arrayContaining(lateRules));
    expect(all.meta.total).toBe(all.data.length);
    await expectPagesMatch(owner, path, all.data);
  });

  it('pages attendance period locks (paged by default) with the total over the filter', async () => {
    for (const month of ['01', '02', '03']) {
      const lock = (
        await owner
          .post('/api/v1/attendance/locks', {
            institutionId: eng,
            periodStart: `2031-${month}-01`,
            periodEnd: `2031-${month}-28`,
            reason: `Paging ${tag}`,
          })
          .expect(201)
      ).body.data;
      created.locks.push(lock.id);
    }
    const path = `/api/v1/attendance/locks?institutionId=${eng}`;
    const all = (await owner.get(`${path}&pageSize=100`).expect(200)).body as ListBody;
    expect(all.meta.total).toBe(
      await prisma.attendancePeriodLock.count({ where: { institutionId: eng } }),
    );
    // Newest period first.
    expect(all.data.slice(0, 3).map((r) => r.id)).toEqual([...created.locks].reverse());
    await expectPagesMatch(owner, path, all.data);
    const dflt = (await owner.get(path).expect(200)).body as ListBody;
    expect(dflt.meta).toMatchObject({ page: 1, pageSize: 20 });
  });
});

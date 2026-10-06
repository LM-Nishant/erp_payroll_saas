import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resolveBranding } from '../src/core/branding';
import { prisma } from '../src/core/db/prisma';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

describe.skipIf(!hasTestDatabase)('branding', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });
  afterAll(() => prisma.$disconnect());

  it('inherits institution → group → organization → platform defaults', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const group = (await owner.get('/api/v1/groups').expect(200)).body.data[0];
    const eng = (await owner.get('/api/v1/institutions?search=Engineering').expect(200)).body
      .data[0];
    expect(eng.code).toBe('ABBS-ENG');

    await owner
      .put('/api/v1/branding/organization', {
        displayName: 'ABBS Education Trust',
        primaryColor: '#123456',
        footerText: 'ABBS Education Trust — Bengaluru',
        subdomain: 'abbs',
      })
      .expect(200);
    await owner
      .put(`/api/v1/branding/groups/${group.id}`, {
        secondaryColor: '#abcdef',
        logoStorageKey: 'branding/abbs-group/logo.png',
      })
      .expect(200);
    const instProfile = (
      await owner
        .put(`/api/v1/branding/institutions/${eng.id}`, {
          letterheadText: 'ABBS College of Engineering\nAffiliated to VTU',
        })
        .expect(200)
    ).body.data;
    expect(instProfile).toMatchObject({ scopeType: 'INSTITUTION', targetId: eng.id });

    const r = (await owner.get(`/api/v1/branding/resolved?institutionId=${eng.id}`).expect(200))
      .body.data;
    expect(r.target).toEqual({ scopeType: 'INSTITUTION', id: eng.id });
    expect(r).toMatchObject({
      displayName: eng.name,
      primaryColor: '#123456',
      secondaryColor: '#ABCDEF',
      logoStorageKey: 'branding/abbs-group/logo.png',
      footerText: 'ABBS Education Trust — Bengaluru',
      letterheadText: 'ABBS College of Engineering\nAffiliated to VTU',
      subdomain: null,
      accentColor: '#F59E0B',
    });
    expect(r.sources).toMatchObject({
      displayName: 'INSTITUTION',
      primaryColor: 'ORGANIZATION',
      secondaryColor: 'GROUP',
      logoStorageKey: 'GROUP',
      letterheadText: 'INSTITUTION',
      accentColor: 'PLATFORM',
    });

    const orgLevel = (await owner.get('/api/v1/branding/resolved').expect(200)).body.data;
    expect(orgLevel).toMatchObject({ displayName: 'ABBS Education Trust', subdomain: 'abbs' });

    // Deleting the institution profile falls back again.
    await owner.delete(`/api/v1/branding/institutions/${eng.id}`).expect(204);
    const after = await resolveBranding(orgIds.abbs!, {
      scopeType: 'INSTITUTION',
      targetId: eng.id,
      groupId: group.id,
      institutionId: eng.id,
    });
    expect(after.letterheadText).toBeNull();

    // /me carries the user's home branding (institution admin → their institution).
    const engAdmin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    const me = (await engAdmin.get('/api/v1/me').expect(200)).body.data;
    expect(me.branding.target).toEqual({ scopeType: 'INSTITUTION', id: eng.id });
    expect(me.branding.primaryColor).toBe('#123456');

    const actions = await prisma.auditLog.findMany({
      where: { organizationId: orgIds.abbs, entityType: 'branding_profile' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['branding.create', 'branding.delete']),
    );
  });

  it('scopes branding management and validates input', async () => {
    const engAdmin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const institutions = (await owner.get('/api/v1/institutions').expect(200)).body.data;
    const eng = institutions.find((i: { code: string }) => i.code === 'ABBS-ENG');
    const other = institutions.find((i: { code: string }) => i.code === 'ABBS-COM');

    await engAdmin.put(`/api/v1/branding/institutions/${eng.id}`, { shortName: 'ENG' }).expect(200);
    await engAdmin
      .put(`/api/v1/branding/institutions/${other.id}`, { shortName: 'COM' })
      .expect(403);
    await engAdmin.put('/api/v1/branding/organization', { shortName: 'X' }).expect(403);
    // The org profile is readable (it is inherited by every level).
    await engAdmin.get('/api/v1/branding/organization').expect(200);
    await engAdmin
      .put(`/api/v1/branding/institutions/${eng.id}`, { primaryColor: 'red' })
      .expect(400);
    await engAdmin
      .put(`/api/v1/branding/institutions/${eng.id}`, { logoStorageKey: '../etc/passwd' })
      .expect(400);
    await engAdmin.put(`/api/v1/branding/institutions/${eng.id}`, { unknown: 1 }).expect(400);

    // Cross-tenant ids are invalid references.
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    const res = await bccAdmin.put(`/api/v1/branding/institutions/${eng.id}`, { shortName: 'x' });
    expect([404, 422]).toContain(res.status);
  });
});

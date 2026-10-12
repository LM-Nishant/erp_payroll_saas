import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearOutbox, messageOutbox } from '../src/core/communication';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { drainJobs } from '../src/core/queue';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

/**
 * Announcements: audience resolution (class / department / institution / students / staff),
 * skipped reporting (no address / invalid / opted out), RBAC scope (HOD vs institution) and the
 * institution's own provider being chosen over the organization default.
 */
describe.skipIf(!hasTestDatabase)('communication audiences & per-institution senders', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const uniq = randomUUID().slice(0, 6);
  const phone = (n: number) =>
    `+91 98${uniq.replace(/\D/g, '').padEnd(4, '7').slice(0, 4)}${n}0000`;
  let abbs: string;
  let eng: string;
  let cseDept: string;
  let comDept: string;
  let cseSection: string;
  let comSection: string;
  let s1: string;
  let s1UserId: string;
  let staffId: string;
  let admin: Client;
  let hod: Client;
  let hr: Client;

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    abbs = fixture.orgIds.abbs!;
    await syncPlanCatalog();
    await provisionOrganizationSubscription(abbs, 'enterprise');
    await prisma.communicationProvider.deleteMany({ where: { organizationId: abbs } });
    eng = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: abbs, code: 'ABBS-ENG' },
      })
    ).id;
    const dept = (code: string) =>
      prisma.department.findFirstOrThrow({ where: { institutionId: eng, code } });
    cseDept = (await dept('CSE')).id;
    comDept = (await dept('COM')).id;
    admin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    hod = await signIn(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    hr = await signIn(app, 'eng.hr@abbs.test', DEMO_PASSWORD);

    const section = async (programCode: string, code: string) =>
      (
        await admin
          .post('/api/v1/class-sections', {
            programId: (
              await prisma.program.findFirstOrThrow({
                where: { organizationId: abbs, code: programCode },
              })
            ).id,
            name: `Announce ${code}`,
            code: `${code}-${uniq}`,
            academicYear: '2026-27',
          })
          .expect(201)
      ).body.data.id as string;
    cseSection = await section('ABBS-ENG-BSC-CS', 'ANC');
    comSection = await section('ABBS-ENG-BCOM', 'ANM');

    const student = async (body: object) =>
      (await admin.post('/api/v1/students', { academicYear: '2026-27', ...body }).expect(201)).body
        .data.id as string;
    s1 = await student({
      classSectionId: cseSection,
      firstName: 'Asha',
      lastName: `Announce ${uniq}`,
      phone: phone(1),
      guardians: [
        {
          name: 'Ravi Parent',
          relation: 'FATHER',
          isPrimary: true,
          phone: phone(2),
          email: `ravi.${uniq}@parents.test`,
        },
      ],
    });
    // No contact at all + a second guardian sharing Ravi's phone (sibling dedupe).
    await student({
      classSectionId: cseSection,
      firstName: 'Bala',
      lastName: `Announce ${uniq}`,
      guardians: [
        { name: 'Silent Guardian', relation: 'MOTHER', isPrimary: true },
        { name: 'Ravi Again', relation: 'FATHER', phone: phone(2) },
      ],
    });
    await student({
      classSectionId: comSection,
      firstName: 'Chitra',
      lastName: `Announce ${uniq}`,
      guardians: [{ name: 'Bad Number', relation: 'MOTHER', isPrimary: true, phone: '1234' }],
    });
    // Student portal user (opt-out is per user).
    const user = await prisma.user.create({
      data: { email: `asha.${uniq}@students.test`, name: 'Asha Student' },
    });
    s1UserId = user.id;
    await prisma.student.update({ where: { id: s1 }, data: { userId: user.id } });

    const grp = await prisma.institution.findUniqueOrThrow({ where: { id: eng } });
    staffId = (
      await prisma.employee.create({
        data: {
          organizationId: abbs,
          groupId: grp.groupId,
          institutionId: eng,
          departmentId: cseDept,
          employeeCode: `ANC-${uniq}`,
          employmentType: 'FULL_TIME',
          status: 'ACTIVE',
          firstName: 'Staff',
          lastName: uniq,
          displayName: `Staff ${uniq}`,
          workEmail: `staff.${uniq}@abbs.test`,
        },
      })
    ).id;
  });

  beforeEach(() => clearOutbox());
  afterAll(async () => {
    await drainJobs();
  });

  const preview = (c: Client, channel: string, audience: object, extra: object = {}) =>
    c.post('/api/v1/communication/audience/preview', { channel, audience, ...extra });

  it('resolves a class section to students + guardians, dedupes and reports skipped', async () => {
    const res = await preview(admin, 'sms', {
      institutionId: eng,
      type: 'class_section',
      ids: [cseSection],
      recipients: 'both',
    }).expect(200);
    const p = res.body.data;
    expect(p.total).toBe(2);
    expect(p.byKind).toEqual({ student: 1, guardian: 1, staff: 0 });
    const ravi = p.sample.find((m: { kind: string }) => m.kind === 'guardian');
    expect(ravi.studentName).toContain('Asha');
    expect(ravi.studentName).toContain('Bala');
    expect(p.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual([
      'NO_ADDRESS',
      'NO_ADDRESS',
    ]);
    expect(p.label).toContain('Students & guardians');

    // Email falls back to the linked user's login e-mail.
    const email = (
      await preview(
        admin,
        'email',
        { institutionId: eng, type: 'students', ids: [s1], recipients: 'both' },
        { subject: 'Hi {{name}}', body: 'Dear {{name}}, about {{studentName}}' },
      ).expect(200)
    ).body.data;
    expect(email.sample.map((m: { address: string }) => m.address).sort()).toEqual([
      `asha.${uniq}@students.test`,
      `ravi.${uniq}@parents.test`,
    ]);
    expect(email.rendered.text).toMatch(/Dear .+, about Asha/);

    const invalid = (
      await preview(admin, 'sms', {
        institutionId: eng,
        type: 'class_section',
        ids: [comSection],
        recipients: 'guardians',
      }).expect(200)
    ).body.data;
    expect(invalid.total).toBe(0);
    expect(invalid.skipped[0]).toMatchObject({ reason: 'INVALID_ADDRESS', name: 'Bad Number' });
  });

  it('skips opted-out users', async () => {
    await prisma.notificationPreference.create({
      data: {
        organizationId: abbs,
        userId: s1UserId,
        eventKey: 'message.broadcast',
        channel: 'email',
        enabled: false,
      },
    });
    const p = (
      await preview(admin, 'email', {
        institutionId: eng,
        type: 'students',
        ids: [s1],
        recipients: 'students',
      }).expect(200)
    ).body.data;
    expect(p.total).toBe(0);
    expect(p.skipped).toEqual([expect.objectContaining({ reason: 'OPTED_OUT', kind: 'student' })]);
  });

  it('resolves staff of a department', async () => {
    const p = (
      await preview(admin, 'email', {
        institutionId: eng,
        type: 'department',
        ids: [cseDept],
        recipients: 'staff',
      }).expect(200)
    ).body.data;
    expect(p.sample.map((m: { address: string }) => m.address)).toContain(
      `staff.${uniq}@abbs.test`,
    );
    const one = (
      await preview(admin, 'email', {
        institutionId: eng,
        type: 'staff',
        ids: [staffId],
        recipients: 'staff',
      }).expect(200)
    ).body.data;
    expect(one.total).toBe(1);
  });

  it('validates audiences', async () => {
    await preview(admin, 'email', { institutionId: eng, type: 'department', ids: [] }).expect(400);
    await preview(admin, 'email', {
      institutionId: eng,
      type: 'institution',
      ids: [cseDept],
    }).expect(400);
    await preview(admin, 'email', {
      institutionId: eng,
      type: 'class_section',
      ids: [cseSection],
      recipients: 'staff',
    }).expect(400);
  });

  it("enforces the caller's scope: an HOD only reaches their own department", async () => {
    const denied = await preview(hod, 'email', { institutionId: eng, type: 'institution' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SCOPE_DENIED');
    await preview(hod, 'email', { institutionId: eng, type: 'department', ids: [comDept] }).expect(
      403,
    );
    await preview(hod, 'email', {
      institutionId: eng,
      type: 'class_section',
      ids: [comSection],
    }).expect(403);
    await preview(hod, 'email', {
      institutionId: eng,
      type: 'class_section',
      ids: [cseSection, comSection],
    }).expect(403);
    await preview(hod, 'email', { institutionId: eng, type: 'department', ids: [cseDept] }).expect(
      200,
    );
    await preview(hod, 'sms', {
      institutionId: eng,
      type: 'class_section',
      ids: [cseSection],
    }).expect(200);

    // No message.broadcast at all (HR manager).
    const hrRes = await preview(hr, 'email', { institutionId: eng, type: 'institution' });
    expect(hrRes.status).toBe(403);
    expect(hrRes.body.error.code).toBe('PERMISSION_DENIED');
  });

  it("sends through the institution's own provider (institution → group → organization)", async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    await owner
      .post('/api/v1/communication/providers', {
        scopeType: 'ORGANIZATION',
        channel: 'sms',
        providerType: 'log',
        name: `Org SMS ${uniq}`,
        config: { senderId: 'ORGSMS' },
      })
      .expect(201);
    // The institution admin configures the institution's own SMS sender.
    const own = (
      await admin
        .post('/api/v1/communication/providers', {
          scopeType: 'INSTITUTION',
          targetId: eng,
          channel: 'sms',
          providerType: 'log',
          name: `ENG SMS ${uniq}`,
          config: { senderId: 'ENGSMS' },
        })
        .expect(201)
    ).body.data;
    // ...but not another institution's.
    const com = await prisma.institution.findFirstOrThrow({
      where: { organizationId: abbs, code: 'ABBS-COM' },
    });
    await admin
      .post('/api/v1/communication/providers', {
        scopeType: 'INSTITUTION',
        targetId: com.id,
        channel: 'sms',
        providerType: 'log',
        name: 'Not mine',
        config: {},
      })
      .expect(403);

    const test = (
      await admin
        .post(`/api/v1/communication/providers/${own.id}/test`, { to: '+91 98450 99999' })
        .expect(200)
    ).body.data;
    expect(test).toMatchObject({ status: 'SENT', to: '+919845099999', error: null });
    expect(messageOutbox.find((m) => m.to === '+919845099999')).toMatchObject({
      providerId: own.id,
      from: 'ENGSMS',
    });
    await admin
      .post(`/api/v1/communication/providers/${own.id}/test`, { to: 'not-a-phone' })
      .expect(400);

    const campaign = (
      await hod
        .post('/api/v1/communication/broadcasts', {
          name: `CSE notice ${uniq}`,
          channel: 'sms',
          audience: {
            institutionId: eng,
            type: 'class_section',
            ids: [cseSection],
            recipients: 'both',
          },
          body: 'Dear {{name}}, PTM on Friday for {{studentName}}.',
        })
        .expect(201)
    ).body.data;
    expect(campaign).toMatchObject({
      institutionId: eng,
      totalRecipients: 2,
      skippedCount: 2,
      audience: expect.objectContaining({ type: 'class_section', ids: [cseSection] }),
    });
    await drainJobs();

    const logs = await prisma.messageLog.findMany({ where: { campaignId: campaign.id } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.providerId === own.id && l.status === 'SENT')).toBe(true);
    const out = messageOutbox.filter((m) => logs.some((l) => l.id === m.logId));
    expect(out.every((m) => m.from === 'ENGSMS')).toBe(true);
    expect(out.map((m) => m.text).join('\n')).toContain('PTM on Friday for Asha');

    // Message log shows the institution provider; the HOD sees their own campaign.
    const listed = (
      await admin.get(`/api/v1/communication/messages?campaignId=${campaign.id}`).expect(200)
    ).body.data;
    expect(listed[0]).toMatchObject({
      providerName: `ENG SMS ${uniq}`,
      providerScope: 'INSTITUTION',
    });
    const mine = (await hod.get('/api/v1/communication/campaigns').expect(200)).body.data;
    expect(mine.map((c: { id: string }) => c.id)).toContain(campaign.id);
    expect(
      (await hod.get(`/api/v1/communication/campaigns/${campaign.id}`).expect(200)).body.data,
    ).toMatchObject({ status: 'COMPLETED', sentCount: 2 });

    // Another institution without its own provider falls back to the organization's.
    const comAdmin = await signIn(app, 'group.admin@abbs.test', DEMO_PASSWORD);
    const comSectionId = (
      await comAdmin
        .post('/api/v1/class-sections', {
          programId: (
            await prisma.program.findFirstOrThrow({
              where: { organizationId: abbs, code: 'ABBS-COM-BCOM' },
            })
          ).id,
          name: 'Announce fallback',
          code: `ANF-${uniq}`,
          academicYear: '2026-27',
        })
        .expect(201)
    ).body.data.id;
    await comAdmin
      .post('/api/v1/students', {
        academicYear: '2026-27',
        classSectionId: comSectionId,
        firstName: 'Deepa',
        lastName: uniq,
        phone: phone(3),
      })
      .expect(201);
    const comCampaign = (
      await comAdmin
        .post('/api/v1/communication/broadcasts', {
          name: `COM notice ${uniq}`,
          channel: 'sms',
          audience: {
            institutionId: com.id,
            type: 'class_section',
            ids: [comSectionId],
            recipients: 'students',
          },
          body: 'Hello {{name}}',
        })
        .expect(201)
    ).body.data;
    await drainJobs();
    const comLog = await prisma.messageLog.findFirstOrThrow({
      where: { campaignId: comCampaign.id },
    });
    const orgProvider = await prisma.communicationProvider.findFirstOrThrow({
      where: { organizationId: abbs, name: `Org SMS ${uniq}` },
    });
    expect(comLog.providerId).toBe(orgProvider.id);
  });

  it('refuses an audience with nobody reachable', async () => {
    const res = await admin
      .post('/api/v1/communication/broadcasts', {
        name: 'Nobody',
        channel: 'sms',
        audience: {
          institutionId: eng,
          type: 'class_section',
          ids: [comSection],
          recipients: 'guardians',
        },
        body: 'x',
      })
      .expect(400);
    expect(res.body.error.message).toContain('phone number');
  });
});

import { createHash, randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import {
  dueExpiryReminders,
  markReminderSent,
  purgeExpiredDocuments,
  registerDocumentOwnerType,
  unregisterDocumentOwnerType,
} from '../src/core/documents';
import { runAsPlatform } from '../src/core/platform';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asBearer,
  hasTestDatabase,
  login,
  seedAccessFixture,
} from './helpers';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pdfBytes = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const REASON = 'Document engine integration test job';

describe.skipIf(!hasTestDatabase)('document engine', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const http = () => supertest(app);
  let orgIds: Record<string, string>;
  let abbs: string;
  let eng: string;
  let com: string;
  let cse: string;
  const tokens: Record<string, string> = {};
  const as = (who: string) => asBearer(app, tokens[who]!);
  const auth = (who: string) => `Bearer ${tokens[who]!}`;

  /** Multipart upload helper. */
  function upload(
    who: string,
    url: string,
    file: { body: Buffer; name: string; type: string },
    fields: Record<string, unknown> = {},
  ) {
    let req = http().post(url).set('Authorization', auth(who));
    for (const [k, v] of Object.entries(fields)) {
      req = req.field(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    return req.attach('file', file.body, { filename: file.name, contentType: file.type });
  }
  const pdf = (text: string) => ({
    body: pdfBytes(text),
    name: `${text}.pdf`,
    type: 'application/pdf',
  });

  async function storageUsed(organizationId: string) {
    const counter = await prisma.usageCounter.findFirst({
      where: { organizationId, limitKey: 'storage_bytes' },
    });
    return Number(counter?.used ?? 0);
  }

  /** Fetch a signed local-storage URL (relative to the API). */
  const fetchSigned = (url: string) => {
    const u = new URL(url, 'http://localhost');
    return http().get(u.pathname + u.search);
  };

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
    abbs = orgIds.abbs!;
    const inst = (code: string) =>
      prisma.institution.findFirstOrThrow({ where: { organizationId: abbs, code } });
    eng = (await inst('ABBS-ENG')).id;
    com = (await inst('ABBS-COM')).id;
    cse = (await prisma.department.findFirstOrThrow({ where: { institutionId: eng, code: 'CSE' } }))
      .id;
    for (const [who, email, org] of [
      ['owner', 'owner@abbs.test', undefined],
      ['engAdmin', 'eng.admin@abbs.test', undefined],
      ['hod', 'cse.hod@abbs.test', undefined],
      ['bcc', 'admin@bcc.test', undefined],
      ['jp', 'admin@jp-college.test', undefined],
    ] as const) {
      tokens[who] = (await login(app, email, DEMO_PASSWORD, org)).accessToken;
    }
  });
  afterAll(() => prisma.$disconnect());

  it('uploads through the API with tenant-isolated keys, metadata, audit and storage usage', async () => {
    const before = await storageUsed(abbs);
    const file = pdf('affiliation');
    const res = await upload('engAdmin', '/api/v1/documents/files', file, {
      metadata: {
        ownerType: 'institution',
        ownerId: eng,
        title: 'Affiliation certificate',
        category: 'institution',
        documentType: 'affiliation',
      },
    }).expect(201);
    const doc = res.body.data;
    expect(doc).toMatchObject({
      ownerType: 'institution',
      ownerId: eng,
      institutionId: eng,
      groupId: expect.any(String),
      confidentiality: 'INTERNAL',
      status: 'ACTIVE',
      currentVersion: {
        versionNumber: 1,
        fileName: 'affiliation.pdf',
        mimeType: 'application/pdf',
        sizeBytes: file.body.length,
        checksumSha256: sha(file.body),
      },
    });
    expect(doc.allowedActions).toEqual(expect.arrayContaining(['view', 'download', 'delete']));
    expect(doc.currentVersion).not.toHaveProperty('storageKey');

    const version = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: doc.currentVersion.id },
    });
    expect(version.storageKey).toMatch(
      new RegExp(
        `^org/${abbs}/inst/${eng}/documents/institution/${eng}/[0-9a-f-]{36}-affiliation\\.pdf$`,
      ),
    );
    expect(await storageUsed(abbs)).toBe(before + file.body.length);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'document.create', entityId: doc.id },
    });
    expect(audit).toBeTruthy();

    // Other tenant: invisible (404), not listed, cannot download.
    await as('bcc').get(`/api/v1/documents/${doc.id}`).expect(404);
    await as('bcc').post(`/api/v1/documents/${doc.id}/download-url`).expect(404);
    const bccList = (await as('bcc').get('/api/v1/documents?pageSize=100').expect(200)).body.data;
    expect(bccList.map((d: { id: string }) => d.id)).not.toContain(doc.id);
  });

  it('rejects disallowed types, spoofed content and client-chosen owners outside the tenant', async () => {
    const meta = { ownerType: 'institution', ownerId: eng, title: 'x' };
    const exe = await upload(
      'engAdmin',
      '/api/v1/documents/files',
      { body: Buffer.from('MZ...'), name: 'tool.exe', type: 'application/octet-stream' },
      { metadata: meta },
    ).expect(400);
    expect(exe.body.error.details.code).toBe('FILE_TYPE_NOT_ALLOWED');
    // HTML pretending to be a PDF (magic bytes do not match).
    await upload(
      'engAdmin',
      '/api/v1/documents/files',
      {
        body: Buffer.from('<html><script>x</script></html>'),
        name: 'x.pdf',
        type: 'application/pdf',
      },
      { metadata: meta },
    ).expect(400);
    // A BCC institution id is not a valid owner inside ABBS.
    const bccInst = await prisma.institution.findFirstOrThrow({
      where: { organizationId: orgIds.bcc!, deletedAt: null },
    });
    await upload('owner', '/api/v1/documents/files', pdf('cross'), {
      metadata: { ownerType: 'institution', ownerId: bccInst.id, title: 'x' },
    }).expect(422);
    await upload('owner', '/api/v1/documents/files', pdf('unknown'), {
      metadata: { ownerType: 'spaceship', ownerId: eng, title: 'x' },
    }).expect(400);
  });

  it('enforces hierarchy scope, RBAC permissions, confidentiality and explicit grants', async () => {
    // Owner uploads a COM document: the ENG admin cannot see it.
    const comDoc = (
      await upload('owner', '/api/v1/documents/files', pdf('com'), {
        metadata: { ownerType: 'institution', ownerId: com, title: 'COM policy' },
      }).expect(201)
    ).body.data;
    await as('engAdmin').get(`/api/v1/documents/${comDoc.id}`).expect(404);
    const engList = (await as('engAdmin').get('/api/v1/documents?pageSize=100').expect(200)).body
      .data;
    expect(engList.map((d: { id: string }) => d.id)).not.toContain(comDoc.id);
    // ENG admin cannot create documents for COM (scope), HOD cannot for the whole ENG.
    await upload('engAdmin', '/api/v1/documents/files', pdf('x'), {
      metadata: { ownerType: 'institution', ownerId: com, title: 'x' },
    }).expect(403);
    await upload('hod', '/api/v1/documents/files', pdf('x'), {
      metadata: { ownerType: 'institution', ownerId: eng, title: 'x' },
    }).expect(403);

    // HOD (department scope) uploads a department document; can view/download, not manage/delete.
    const deptDoc = (
      await upload('hod', '/api/v1/documents/files', pdf('timetable'), {
        metadata: { ownerType: 'department', ownerId: cse, title: 'CSE timetable' },
      }).expect(201)
    ).body.data;
    expect(deptDoc).toMatchObject({ departmentId: cse, institutionId: eng });
    await as('hod').patch(`/api/v1/documents/${deptDoc.id}`, { title: 'Renamed' }).expect(403);
    await as('hod').delete(`/api/v1/documents/${deptDoc.id}`).expect(403);
    await as('engAdmin').get(`/api/v1/documents/${deptDoc.id}`).expect(200);

    // CONFIDENTIAL department document: HOD lacks document.view_confidential.
    const conf = (
      await upload('owner', '/api/v1/documents/files', pdf('salary-review'), {
        metadata: {
          ownerType: 'department',
          ownerId: cse,
          title: 'Salary review',
          confidentiality: 'CONFIDENTIAL',
        },
      }).expect(201)
    ).body.data;
    await as('hod').get(`/api/v1/documents/${conf.id}`).expect(404);
    await as('engAdmin').get(`/api/v1/documents/${conf.id}`).expect(200);

    // RESTRICTED: only org-wide confidential access or explicit grants (not the ENG admin).
    const restricted = (
      await upload('owner', '/api/v1/documents/files', pdf('board-minutes'), {
        metadata: {
          ownerType: 'institution',
          ownerId: eng,
          title: 'Board minutes',
          confidentiality: 'RESTRICTED',
        },
      }).expect(201)
    ).body.data;
    await as('engAdmin').get(`/api/v1/documents/${restricted.id}`).expect(404);

    // Explicit USER grant gives the HOD view + download on the confidential document only.
    const hodUser = await prisma.user.findUniqueOrThrow({ where: { email: 'cse.hod@abbs.test' } });
    await as('hod')
      .post(`/api/v1/documents/${deptDoc.id}/permissions`, {
        granteeType: 'USER',
        userId: hodUser.id,
        actions: ['view'],
      })
      .expect(403);
    const grant = (
      await as('owner')
        .post(`/api/v1/documents/${conf.id}/permissions`, {
          granteeType: 'USER',
          userId: hodUser.id,
          actions: ['download'],
        })
        .expect(201)
    ).body.data;
    const seen = (await as('hod').get(`/api/v1/documents/${conf.id}`).expect(200)).body.data;
    expect(seen.allowedActions.sort()).toEqual(['download', 'view']);
    await as('hod').post(`/api/v1/documents/${conf.id}/download-url`).expect(201);
    await as('hod').delete(`/api/v1/documents/${conf.id}`).expect(403);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'document.share', entityId: conf.id } }),
    ).toBeTruthy();
    await as('owner').delete(`/api/v1/documents/${conf.id}/permissions/${grant.id}`).expect(204);
    await as('hod').get(`/api/v1/documents/${conf.id}`).expect(404);

    // ROLE grant: every HOD in the org may view the COM document.
    await as('owner')
      .post(`/api/v1/documents/${comDoc.id}/permissions`, {
        granteeType: 'ROLE',
        roleKey: 'hod',
        actions: ['view'],
      })
      .expect(201);
    await as('hod').get(`/api/v1/documents/${comDoc.id}`).expect(200);
    await as('hod').post(`/api/v1/documents/${comDoc.id}/download-url`).expect(403);
  });

  it('issues short-lived, audited signed download URLs that cannot be tampered with', async () => {
    const file = pdf('handbook');
    const doc = (
      await upload('engAdmin', '/api/v1/documents/files', file, {
        metadata: { ownerType: 'institution', ownerId: eng, title: 'Handbook' },
      }).expect(201)
    ).body.data;
    const signed = (
      await as('engAdmin')
        .post(`/api/v1/documents/${doc.id}/download-url`, { disposition: 'attachment' })
        .expect(201)
    ).body.data;
    expect(signed).toMatchObject({ fileName: 'handbook.pdf', mimeType: 'application/pdf' });
    const ttl = new Date(signed.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600_000);

    const res = await fetchSigned(signed.url).buffer(true).expect(200);
    expect(Buffer.from(res.body).equals(file.body)).toBe(true);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['content-disposition']).toContain('attachment');

    const audits = await prisma.auditLog.findMany({
      where: { action: 'document.download', entityId: doc.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ versionId: doc.currentVersion.id });

    // Tampered token.
    const u = new URL(signed.url, 'http://localhost');
    const [payload, mac] = u.pathname.split('/').pop()!.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...decoded, key: `org/${orgIds.bcc}/x` })).toString(
      'base64url',
    );
    await http().get(`/api/v1/storage/local/${forged}.${mac}`).expect(403);
  });

  it('versions are immutable; new versions and restore create new rows', async () => {
    const v1 = pdf('policy-v1');
    const doc = (
      await upload('engAdmin', '/api/v1/documents/files', v1, {
        metadata: { ownerType: 'institution', ownerId: eng, title: 'HR policy' },
      }).expect(201)
    ).body.data;
    const v2 = pdf('policy-v2-longer');
    const created = (
      await upload('engAdmin', `/api/v1/documents/${doc.id}/versions`, v2, {
        reason: 'Annual update',
      }).expect(201)
    ).body.data;
    expect(created).toMatchObject({
      versionNumber: 2,
      checksumSha256: sha(v2.body),
      isCurrent: true,
    });

    const restored = (
      await as('engAdmin')
        .post(`/api/v1/documents/${doc.id}/versions/${doc.currentVersion.id}/restore`, {
          reason: 'Rollback',
        })
        .expect(201)
    ).body.data;
    expect(restored).toMatchObject({
      versionNumber: 3,
      checksumSha256: sha(v1.body),
      restoredFromVersionId: doc.currentVersion.id,
    });
    const versions = (await as('engAdmin').get(`/api/v1/documents/${doc.id}/versions`).expect(200))
      .body.data;
    expect(versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([3, 2, 1]);
    const keys = await prisma.documentVersion.findMany({ where: { documentId: doc.id } });
    expect(new Set(keys.map((k) => k.storageKey)).size).toBe(3);

    // DB triggers forbid rewriting or deleting a version.
    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE document_versions SET checksum_sha256 = ? WHERE id = ?',
        'f'.repeat(64),
        doc.currentVersion.id,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM document_versions WHERE id = ?', doc.currentVersion.id),
    ).rejects.toThrow();

    // Old versions stay downloadable.
    const old = (
      await as('engAdmin')
        .post(`/api/v1/documents/${doc.id}/download-url`, { versionId: doc.currentVersion.id })
        .expect(201)
    ).body.data;
    const body = await fetchSigned(old.url).buffer(true).expect(200);
    expect(Buffer.from(body.body).equals(v1.body)).toBe(true);
  });

  it('supports the signed-URL upload flow with server-side verification', async () => {
    const file = pdf('scanned-form');
    const ticket = (
      await as('engAdmin')
        .post('/api/v1/documents/uploads', {
          document: { ownerType: 'institution', ownerId: eng, title: 'Scanned form' },
          fileName: 'scanned-form.pdf',
          mimeType: 'application/pdf',
          sizeBytes: file.body.length,
          checksumSha256: sha(file.body),
        })
        .expect(201)
    ).body.data;
    expect(ticket).toMatchObject({ method: 'PUT', uploadId: expect.any(String) });
    // Another user cannot complete someone else's upload.
    await as('owner').post(`/api/v1/documents/uploads/${ticket.uploadId}/complete`).expect(404);

    const u = new URL(ticket.url, 'http://localhost');
    let put = http().put(u.pathname + u.search);
    for (const [k, v] of Object.entries(ticket.headers as Record<string, string>))
      put = put.set(k, v);
    // Wrong bytes for the signed checksum are refused by the storage endpoint.
    await http()
      .put(u.pathname + u.search)
      .set('Content-Type', 'application/pdf')
      .send(pdfBytes('scanned-forX'))
      .expect(400);
    await put.send(file.body).expect(200);

    const done = (
      await as('engAdmin').post(`/api/v1/documents/uploads/${ticket.uploadId}/complete`).expect(201)
    ).body.data;
    expect(done.document).toMatchObject({
      title: 'Scanned form',
      currentVersion: { sizeBytes: file.body.length, checksumSha256: sha(file.body) },
    });
    await as('engAdmin').post(`/api/v1/documents/uploads/${ticket.uploadId}/complete`).expect(409);
  });

  it('enforces the storage_bytes limit', async () => {
    const jp = orgIds['jp-college']!;
    const used = await storageUsed(jp);
    const sub = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: jp },
    });
    await prisma.organizationSubscription.update({
      where: { organizationId: jp },
      data: { limitOverrides: { storage_bytes: used + 60 } },
    });
    try {
      const jpc = await prisma.institution.findFirstOrThrow({
        where: { organizationId: jp, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const meta = { metadata: { ownerType: 'institution', ownerId: jpc.id, title: 'Big' } };
      const small = pdf('a');
      expect(small.body.length).toBeLessThan(60);
      await upload('jp', '/api/v1/documents/files', small, meta).expect(201);
      const res = await upload(
        'jp',
        '/api/v1/documents/files',
        pdf('this-one-is-too-large-for-the-remaining-quota'),
        meta,
      ).expect(403);
      expect(res.body.error.code).toBe('LIMIT_EXCEEDED');
      expect(await storageUsed(jp)).toBe(used + small.body.length);
      // The signed-URL flow checks the declared size up-front.
      await as('jp')
        .post('/api/v1/documents/uploads', {
          document: { ownerType: 'institution', ownerId: jpc.id, title: 'Huge' },
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10_000,
        })
        .expect(403);
    } finally {
      await prisma.organizationSubscription.update({
        where: { organizationId: jp },
        data: { limitOverrides: sub.limitOverrides ?? {} },
      });
    }
  });

  it('tracks expiry: expiring query, due reminders hook and soft delete + purge', async () => {
    const doc = (
      await upload('engAdmin', '/api/v1/documents/files', pdf('fire-noc'), {
        metadata: {
          ownerType: 'institution',
          ownerId: eng,
          title: 'Fire NOC',
          category: 'institution',
          expiryDate: isoDay(10),
          reminderDays: [30, 7, 1],
        },
      }).expect(201)
    ).body.data;
    // The 30-day reminder is already in the past and is not scheduled.
    expect(doc.reminderDays).toEqual([7, 1]);
    const expiring = (
      await as('engAdmin').get('/api/v1/documents/expiring?withinDays=15').expect(200)
    ).body.data;
    expect(expiring.find((d: { id: string }) => d.id === doc.id)).toMatchObject({
      daysRemaining: 10,
    });
    const outside = (
      await as('engAdmin').get('/api/v1/documents/expiring?withinDays=5').expect(200)
    ).body.data;
    expect(outside.map((d: { id: string }) => d.id)).not.toContain(doc.id);
    // Other tenants never see it.
    const bcc = (await as('bcc').get('/api/v1/documents/expiring?withinDays=30').expect(200)).body
      .data;
    expect(bcc.map((d: { id: string }) => d.id)).not.toContain(doc.id);

    const due = await runAsPlatform({ organizationId: abbs, reason: REASON }, () =>
      dueExpiryReminders({ asOf: new Date(`${isoDay(4)}T00:00:00Z`) }),
    );
    const mine = due.filter((r) => r.documentId === doc.id);
    expect(mine.map((r) => r.daysBefore)).toEqual([7]);
    await runAsPlatform({ organizationId: abbs, reason: REASON }, () =>
      markReminderSent(mine[0]!.reminderId),
    );
    const again = await runAsPlatform({ organizationId: abbs, reason: REASON }, () =>
      dueExpiryReminders({ asOf: new Date(`${isoDay(4)}T00:00:00Z`) }),
    );
    expect(again.filter((r) => r.documentId === doc.id)).toHaveLength(0);
    // Another tenant's job context sees nothing of ABBS.
    const bccDue = await runAsPlatform({ organizationId: orgIds.bcc!, reason: REASON }, () =>
      dueExpiryReminders({ asOf: new Date(`${isoDay(30)}T00:00:00Z`) }),
    );
    expect(bccDue.map((r) => r.documentId)).not.toContain(doc.id);

    // Soft delete with retention, then purge returns the bytes to the quota.
    const usedBefore = await storageUsed(abbs);
    await as('engAdmin').delete(`/api/v1/documents/${doc.id}?reason=Superseded`).expect(204);
    await as('engAdmin').get(`/api/v1/documents/${doc.id}`).expect(404);
    const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.deletedAt).toBeTruthy();
    expect(row.purgeAfter!.getTime()).toBeGreaterThan(Date.now());
    expect(await storageUsed(abbs)).toBe(usedBefore);
    const purged = await runAsPlatform({ organizationId: abbs, reason: REASON }, () =>
      purgeExpiredDocuments({ now: new Date(Date.now() + 10 * 365 * 86_400_000) }),
    );
    expect(purged.versions).toBeGreaterThanOrEqual(1);
    expect(purged.bytes).toBeGreaterThanOrEqual(doc.currentVersion.sizeBytes);
    expect(await storageUsed(abbs)).toBe(usedBefore - purged.bytes);
    const version = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: doc.currentVersion.id },
    });
    expect(version.purgedAt).toBeTruthy();
  });

  it('owner-access resolvers give owners self-access to their own documents', async () => {
    const widgetId = randomUUID();
    const roles = (await as('owner').get('/api/v1/roles?pageSize=100').expect(200)).body.data;
    const employeeRole = roles.find((r: { key: string }) => r.key === 'employee');
    const email = `self-${Date.now()}@abbs.test`;
    const user = (
      await as('owner')
        .post('/api/v1/users', {
          email,
          name: 'Self Service',
          password: 'Self-Passw0rd!',
          roles: [{ roleId: employeeRole.id, scopes: [{ type: 'INSTITUTION', id: eng }] }],
        })
        .expect(201)
    ).body.data;
    tokens.self = (await login(app, email, 'Self-Passw0rd!')).accessToken;

    registerDocumentOwnerType({
      type: 'test_widget',
      resolveScope: async (id) =>
        id === widgetId
          ? { groupId: null, institutionId: eng, campusId: null, departmentId: null }
          : null,
      selfAccess: {
        actions: ['view', 'download'],
        ownedIds: async (principal) => (principal.userId === user.id ? [widgetId] : []),
      },
    });
    try {
      const mine = (
        await upload('owner', '/api/v1/documents/files', pdf('payslip'), {
          metadata: {
            ownerType: 'test_widget',
            ownerId: widgetId,
            title: 'My payslip',
            confidentiality: 'CONFIDENTIAL',
          },
        }).expect(201)
      ).body.data;
      const other = (
        await upload('owner', '/api/v1/documents/files', pdf('other'), {
          metadata: { ownerType: 'institution', ownerId: eng, title: 'Institution doc' },
        }).expect(201)
      ).body.data;

      const list = (await as('self').get('/api/v1/documents?pageSize=100').expect(200)).body.data;
      expect(list.map((d: { id: string }) => d.id)).toEqual([mine.id]);
      const got = (await as('self').get(`/api/v1/documents/${mine.id}`).expect(200)).body.data;
      expect(got.allowedActions.sort()).toEqual(['download', 'view']);
      await as('self').post(`/api/v1/documents/${mine.id}/download-url`).expect(201);
      await as('self').delete(`/api/v1/documents/${mine.id}`).expect(403);
      await as('self').get(`/api/v1/documents/${other.id}`).expect(404);
    } finally {
      unregisterDocumentOwnerType('test_widget');
    }
  });

  it('uploads branding logos and renders branded PDFs stored as documents', async () => {
    const profile = (
      await http()
        .post(`/api/v1/branding/institutions/${eng}/logo`)
        .set('Authorization', auth('engAdmin'))
        .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(201)
    ).body.data;
    expect(profile.logoFileId).toEqual(expect.any(String));
    expect(profile.logoStorageKey).toMatch(
      new RegExp(`^org/${abbs}/inst/${eng}/branding/institution/${eng}/`),
    );
    const logoDoc = await prisma.document.findUniqueOrThrow({ where: { id: profile.logoFileId } });
    expect(logoDoc).toMatchObject({
      module: 'branding',
      category: 'branding',
      confidentiality: 'PUBLIC',
    });

    // Non-images are refused for logos.
    await http()
      .post(`/api/v1/branding/institutions/${eng}/logo`)
      .set('Authorization', auth('engAdmin'))
      .attach('file', pdfBytes('x'), { filename: 'logo.pdf', contentType: 'application/pdf' })
      .expect(400);

    // PUT without logo fields keeps the uploaded logo.
    await as('engAdmin')
      .put(`/api/v1/branding/institutions/${eng}`, { primaryColor: '#AA0000' })
      .expect(200);
    const resolved = (
      await as('engAdmin').get(`/api/v1/branding/resolved?institutionId=${eng}`).expect(200)
    ).body.data;
    expect(resolved).toMatchObject({ logoFileId: profile.logoFileId, primaryColor: '#AA0000' });

    const logoUrl = (
      await as('engAdmin').get(`/api/v1/branding/logo-url?institutionId=${eng}`).expect(200)
    ).body.data;
    const logo = await fetchSigned(logoUrl.url).buffer(true).expect(200);
    expect(Buffer.from(logo.body).equals(PNG)).toBe(true);

    // App-shell logo: any member gets the logo of their home scope (HOD → Engineering).
    const homeLogo = (await as('hod').get('/api/v1/branding/home-logo-url').expect(200)).body.data;
    expect(homeLogo.versionId).toBe(logoUrl.versionId);
    expect((await as('bcc').get('/api/v1/branding/home-logo-url').expect(200)).body.data).toBe(
      null,
    );

    const templates = (await as('engAdmin').get('/api/v1/pdf/templates').expect(200)).body.data;
    expect(templates.map((t: { key: string }) => t.key)).toContain('generic_letter');
    await as('hod')
      .post('/api/v1/pdf/generate', {
        templateKey: 'generic_letter',
        ownerType: 'institution',
        ownerId: eng,
        data: { recipientName: 'A', subject: 'B', body: 'C' },
      })
      .expect(403);
    await as('engAdmin')
      .post('/api/v1/pdf/generate', {
        templateKey: 'generic_letter',
        ownerType: 'institution',
        ownerId: eng,
        data: { subject: 'missing recipient', body: 'x' },
      })
      .expect(400);

    const generated = (
      await as('engAdmin')
        .post('/api/v1/pdf/generate', {
          templateKey: 'generic_letter',
          ownerType: 'institution',
          ownerId: eng,
          data: {
            recipientName: 'Dr. Asha Rao',
            subject: 'Appreciation',
            body: 'Thank you for your contribution.\n\nRegards.',
            signatoryName: 'Principal',
          },
        })
        .expect(201)
    ).body.data;
    expect(generated).toMatchObject({
      module: 'pdf',
      ownerType: 'institution',
      ownerId: eng,
      category: 'correspondence',
      documentType: 'letter',
      title: 'Appreciation',
      metadata: {
        templateKey: 'generic_letter',
        templateVersion: 1,
        branding: { primaryColor: '#AA0000', logoFileId: profile.logoFileId },
      },
      currentVersion: { mimeType: 'application/pdf', fileName: 'appreciation.pdf' },
    });
    const url = (
      await as('engAdmin').post(`/api/v1/documents/${generated.id}/download-url`).expect(201)
    ).body.data.url;
    const bytes = Buffer.from((await fetchSigned(url).buffer(true).expect(200)).body).toString(
      'latin1',
    );
    expect(bytes.startsWith('%PDF-')).toBe(true);
    expect(bytes).toContain('/Subtype /Image');

    // Detaching the logo stops PDFs from embedding it.
    await http()
      .delete(`/api/v1/branding/institutions/${eng}/logo`)
      .set('Authorization', auth('engAdmin'))
      .expect(200);
    const plain = (
      await as('engAdmin')
        .post('/api/v1/pdf/generate', {
          templateKey: 'generic_letter',
          ownerType: 'institution',
          ownerId: eng,
          data: { recipientName: 'X', subject: 'No logo', body: 'Body' },
        })
        .expect(201)
    ).body.data;
    expect(plain.metadata.branding.logoFileId).toBeNull();
  });
});

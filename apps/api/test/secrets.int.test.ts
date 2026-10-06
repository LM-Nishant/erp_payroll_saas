import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { runAsPlatform } from '../src/core/platform';
import { LocalKeyProvider, getSecret, keyProvider, setKeyProvider } from '../src/core/secrets';
import { parseMasterKeys, env } from '../src/core/config/env';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

const SMTP_PASSWORD = 'smtp-PLAINTEXT-do-not-leak-9876';
const ROTATED = 'smtp-ROTATED-do-not-leak-5432';
const INST_KEY = 'sk-INSTITUTION-only-key-1111';
const REASON = 'Engine integration test: read secret';

describe.skipIf(!hasTestDatabase)('secret management', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });
  afterAll(async () => {
    setKeyProvider(null);
    await prisma.$disconnect();
  });

  async function assertNoPlaintextAnywhere(...values: string[]) {
    const [secrets, audits] = await Promise.all([
      prisma.tenantSecret.findMany(),
      prisma.auditLog.findMany({ where: { entityType: 'tenant_secret' } }),
    ]);
    const dump = JSON.stringify([secrets, audits]);
    for (const v of values) expect(dump).not.toContain(v);
  }

  it('is write-only: create/list/get/rotate never return the value', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const created = await owner
      .post('/api/v1/secrets', {
        kind: 'smtp',
        value: SMTP_PASSWORD,
        description: 'Transactional mail',
        metadata: { host: 'smtp.example.com', port: 587 },
      })
      .expect(201);
    const secret = created.body.data;
    expect(secret).toMatchObject({
      kind: 'smtp',
      name: 'default',
      scopeType: 'ORGANIZATION',
      masked: '••••••••9876',
      version: 1,
      keyVersion: env.SECRETS_ACTIVE_KEY_VERSION,
      metadata: { host: 'smtp.example.com', port: 587 },
      createdBy: { name: expect.any(String) },
    });
    expect(secret.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const list = await owner.get('/api/v1/secrets').expect(200);
    const one = await owner.get(`/api/v1/secrets/${secret.id}`).expect(200);
    for (const res of [created, list, one]) {
      expect(JSON.stringify(res.body)).not.toContain(SMTP_PASSWORD);
      expect(JSON.stringify(res.body)).not.toMatch(/ciphertext|wrappedKey/);
    }

    // Duplicate (same scope/kind/name) → 409
    await owner.post('/api/v1/secrets', { kind: 'smtp', value: 'other-value' }).expect(409);
    // Sensitive-looking metadata is refused.
    await owner
      .post('/api/v1/secrets', { kind: 'sms', value: 'x', metadata: { apiKey: 'leak' } })
      .expect(400);

    const rotated = (
      await owner.post(`/api/v1/secrets/${secret.id}/rotate`, { value: ROTATED }).expect(200)
    ).body.data;
    expect(rotated).toMatchObject({ version: 2, masked: '••••••••5432' });
    expect(rotated.rotatedAt).toBeTruthy();
    expect(rotated.fingerprint).not.toBe(secret.fingerprint);

    const value = await runAsPlatform({ organizationId: orgIds.abbs!, reason: REASON }, () =>
      getSecret({ kind: 'smtp', purpose: 'email.send' }),
    );
    expect(value!.reveal()).toBe(ROTATED);
    expect(JSON.stringify({ value })).not.toContain(ROTATED);

    await assertNoPlaintextAnywhere(SMTP_PASSWORD, ROTATED);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: orgIds.abbs, entityId: secret.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['secret.create', 'secret.rotate', 'secret.access']);
  });

  it('resolves institution → group → organization for engines', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const institutions = (await owner.get('/api/v1/institutions').expect(200)).body.data;
    const eng = institutions.find((i: { code: string }) => i.code === 'ABBS-ENG');
    const com = institutions.find((i: { code: string }) => i.code === 'ABBS-COM');
    await owner
      .post('/api/v1/secrets', {
        scopeType: 'INSTITUTION',
        targetId: eng.id,
        kind: 'smtp',
        value: INST_KEY,
      })
      .expect(201);
    const [forEng, forCom] = await runAsPlatform(
      { organizationId: orgIds.abbs!, reason: REASON },
      async () => [
        await getSecret({ kind: 'smtp', institutionId: eng.id, purpose: 'email.send' }),
        await getSecret({ kind: 'smtp', institutionId: com.id, purpose: 'email.send' }),
      ],
    );
    expect(forEng!.reveal()).toBe(INST_KEY);
    expect(forEng!.meta.scopeType).toBe('INSTITUTION');
    expect(forCom!.reveal()).toBe(ROTATED);
    expect(forCom!.meta.scopeType).toBe('ORGANIZATION');
    const missing = await runAsPlatform({ organizationId: orgIds.abbs!, reason: REASON }, () =>
      getSecret({ kind: 'ai.openai', purpose: 'ai.chat' }),
    );
    expect(missing).toBeNull();
  });

  it('isolates secrets between tenants and scopes', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const abbsSecret = (await owner.get('/api/v1/secrets?kind=smtp').expect(200)).body.data[0];
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    // BCC group admin: secret.view only — sees no ABBS secrets, can't read / rotate them.
    const bccList = (await bccAdmin.get('/api/v1/secrets').expect(200)).body;
    expect(bccList.data).toEqual([]);
    await bccAdmin.get(`/api/v1/secrets/${abbsSecret.id}`).expect(404);
    await bccAdmin.post(`/api/v1/secrets/${abbsSecret.id}/rotate`, { value: 'x' }).expect(403);
    // Group admin of ABBS cannot see organization-level secrets, only its group's.
    const groupAdmin = await signIn(app, 'group.admin@abbs.test', DEMO_PASSWORD);
    const visible = (await groupAdmin.get('/api/v1/secrets').expect(200)).body.data;
    expect(visible.every((s: { scopeType: string }) => s.scopeType !== 'ORGANIZATION')).toBe(true);
    expect(visible.some((s: { scopeType: string }) => s.scopeType === 'INSTITUTION')).toBe(true);
    await groupAdmin.get(`/api/v1/secrets/${abbsSecret.id}`).expect(404);
    // Institution admin has no secret permissions at all.
    const engAdmin = await signIn(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    await engAdmin.get('/api/v1/secrets').expect(403);
    // BCC engines cannot read ABBS secrets.
    const fromBcc = await runAsPlatform({ organizationId: orgIds.bcc!, reason: REASON }, () =>
      getSecret({ kind: 'smtp', purpose: 'email.send' }),
    );
    expect(fromBcc).toBeNull();
    // A ciphertext moved to another tenant's row cannot be decrypted (AAD binding).
    const row = await prisma.tenantSecret.findUniqueOrThrow({ where: { id: abbsSecret.id } });
    const bccRow = await prisma.tenantSecret.create({
      data: {
        organizationId: orgIds.bcc!,
        scopeType: 'ORGANIZATION',
        targetId: orgIds.bcc!,
        kind: 'smtp',
        name: 'default',
        ciphertext: row.ciphertext,
        wrappedKey: row.wrappedKey,
        keyVersion: row.keyVersion,
        keyProvider: row.keyProvider,
        fingerprint: row.fingerprint,
      },
    });
    await expect(
      runAsPlatform({ organizationId: orgIds.bcc!, reason: REASON }, () =>
        getSecret({ kind: 'smtp', purpose: 'email.send' }),
      ),
    ).rejects.toThrow(/could not be decrypted/);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgIds.bcc, action: 'secret.access_failed', entityId: bccRow.id },
      }),
    ).toBe(1);
    await prisma.tenantSecret.delete({ where: { id: bccRow.id } });
  });

  it('rotates the master key by re-wrapping data keys', async () => {
    const current = parseMasterKeys(env.SECRETS_MASTER_KEYS);
    const nextVersion = Math.max(...current.keys()) + 1;
    const keys = new Map(current);
    keys.set(nextVersion, randomBytes(32));
    const fingerprintBefore = keyProvider().fingerprint('x', 'y');
    setKeyProvider(new LocalKeyProvider(keys, nextVersion));
    try {
      expect(keyProvider().fingerprint('x', 'y')).toBe(fingerprintBefore);
      const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
      const res = (
        await platform
          .post('/api/v1/platform/secrets/rewrap', { reason: 'Quarterly master key rotation' })
          .expect(200)
      ).body.data;
      expect(res.activeKeyVersion).toBe(nextVersion);
      expect(res.rewrapped).toBeGreaterThanOrEqual(2);
      const rows = await prisma.tenantSecret.findMany({
        where: { organizationId: orgIds.abbs },
      });
      expect(rows.every((r) => r.keyVersion === nextVersion)).toBe(true);
      // Old master key retired: values still decrypt.
      setKeyProvider(
        new LocalKeyProvider(new Map([[nextVersion, keys.get(nextVersion)!]]), nextVersion),
      );
      const value = await runAsPlatform({ organizationId: orgIds.abbs!, reason: REASON }, () =>
        getSecret({ kind: 'smtp', purpose: 'email.send' }),
      );
      expect(value!.reveal()).toBe(ROTATED);
      expect(
        await prisma.auditLog.count({
          where: { organizationId: orgIds.abbs, action: 'secret.rewrap' },
        }),
      ).toBe(1);
    } finally {
      setKeyProvider(null);
    }
  });

  it('deletes secrets (audited) and validates input', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const s = (
      await owner
        .post('/api/v1/secrets', { kind: 'ai.openai', value: 'sk-test-DELETE-me-0000' })
        .expect(201)
    ).body.data;
    await owner
      .patch(`/api/v1/secrets/${s.id}`, { description: 'OpenAI', metadata: { model: 'gpt' } })
      .expect(200);
    await owner.patch(`/api/v1/secrets/${s.id}`, { value: 'nope' }).expect(400);
    await owner.delete(`/api/v1/secrets/${s.id}`).expect(204);
    await owner.get(`/api/v1/secrets/${s.id}`).expect(404);
    await owner.post('/api/v1/secrets', { kind: 'Bad Kind', value: 'x' }).expect(400);
    await owner
      .post('/api/v1/secrets', { scopeType: 'INSTITUTION', kind: 'sms', value: 'x' })
      .expect(400);
    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: s.id }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual(['secret.create', 'secret.update', 'secret.delete']);
    await assertNoPlaintextAnywhere('sk-test-DELETE-me-0000');
  });
});

import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashPassword } from '../src/core/auth/password';
import { totp } from '../src/core/auth/totp';
import { messageOutbox } from '../src/core/communication';
import { prisma } from '../src/core/db/prisma';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asBearer,
  hasTestDatabase,
  login,
  seedAccessFixture,
} from './helpers';

function tokenFromOutbox(to: string, path: string): string {
  const mail = [...messageOutbox].reverse().find((m) => m.to === to && m.text.includes(path));
  const match = mail?.text.match(/token=([A-Za-z0-9_%.-]+)/);
  if (!match?.[1]) throw new Error(`No ${path} e-mail for ${to}`);
  return decodeURIComponent(match[1]);
}

describe.skipIf(!hasTestDatabase)('authentication', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const http = () => supertest(app);
  let orgIds: Record<string, string>;

  /** Fresh member of ABBS (institution admin of ABBS-ENG) for destructive scenarios. */
  async function makeUser(tag: string) {
    const email = `${tag}-${Date.now()}@abbs.test`;
    const user = await prisma.user.create({
      data: { email, name: tag, passwordHash: await hashPassword(DEMO_PASSWORD) },
    });
    await prisma.organizationMembership.create({
      data: { organizationId: orgIds.abbs!, userId: user.id, status: 'ACTIVE' },
    });
    return { email, id: user.id };
  }

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });

  afterAll(() => prisma.$disconnect());

  it('logs in, returns tokens and records login history', async () => {
    const tokens = await login(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    expect(tokens.mfaRequired).toBe(false);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const me = await asBearer(app, tokens.accessToken).get('/api/v1/me').expect(200);
    expect(me.body.data.user.email).toBe('eng.admin@abbs.test');
    expect(me.body.data.organization.slug).toBe('abbs');
    expect(me.body.data.permissions).toContain('institution.view');
    expect(me.body.data.roles[0]).toMatchObject({ key: 'institution_admin' });
    expect(me.body.data.roles[0].scopes[0]).toMatchObject({
      type: 'INSTITUTION',
      name: 'ABBS College of Engineering',
    });

    const history = await asBearer(app, tokens.accessToken)
      .get('/api/v1/auth/login-history')
      .expect(200);
    expect(history.body.data[0]).toMatchObject({ success: true });
  });

  it('rejects bad credentials without revealing whether the email exists', async () => {
    const wrong = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'eng.admin@abbs.test', password: 'nope-nope-nope' })
      .expect(401);
    const unknown = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@abbs.test', password: 'nope-nope-nope' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    const failures = await prisma.loginEvent.findMany({
      where: { email: 'ghost@abbs.test', success: false },
    });
    expect(failures.length).toBeGreaterThan(0);
  });

  it('rejects client-supplied tenant identifiers on login', async () => {
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'eng.admin@abbs.test', password: DEMO_PASSWORD, organizationId: 'x' })
      .expect(400);
  });

  it('refuses sign-in to an organization the user does not belong to', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'eng.admin@abbs.test', password: DEMO_PASSWORD, organization: 'bcc' })
      .expect(403);
    expect(res.body.error.code).toBe('ORGANIZATION_ACCESS_DENIED');
  });

  it('locks the account after repeated failures', async () => {
    const { email } = await makeUser('lockout');
    for (let i = 0; i < 5; i++) {
      await http().post('/api/v1/auth/login').send({ email, password: 'wrong-password-1' });
    }
    const locked = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rate limits auth endpoints', async () => {
    const limited = createApp({ authRateLimit: { windowMs: 60_000, max: 2 } });
    const send = () =>
      supertest(limited)
        .post('/api/v1/auth/login')
        .send({ email: 'rl@abbs.test', password: 'whatever-12' });
    await send().expect(401);
    await send().expect(401);
    const res = await send().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const tokens = await login(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
    const first = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    const rotated = first.body.data.refreshToken as string;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(tokens.refreshToken);

    // Replaying the old token is reuse: the whole session is revoked.
    const reuse = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    await http().post('/api/v1/auth/refresh').send({ refreshToken: rotated }).expect(401);
    const revoked = await asBearer(app, first.body.data.accessToken).get('/api/v1/me').expect(401);
    expect(revoked.body.error.code).toBe('SESSION_REVOKED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.refresh_token_reused', organizationId: orgIds.abbs },
    });
    expect(audit).not.toBeNull();
  });

  it('delivers refresh tokens as an httpOnly cookie when requested', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'eng.admin@abbs.test', password: DEMO_PASSWORD, tokenDelivery: 'cookie' })
      .expect(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/erp_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.split(';')[0]!)
      .send({})
      .expect(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  it('logs out and lists / revokes sessions', async () => {
    const a = await login(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    const b = await login(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    const sessions = await asBearer(app, a.accessToken).get('/api/v1/auth/sessions').expect(200);
    expect(sessions.body.data.length).toBeGreaterThanOrEqual(2);
    const other = sessions.body.data.find((s: { current: boolean }) => !s.current);
    expect(other).toBeDefined();

    await asBearer(app, b.accessToken).delete(`/api/v1/auth/sessions/${other.id}`);
    await asBearer(app, a.accessToken).post('/api/v1/auth/logout').expect(204);
    const after = await asBearer(app, a.accessToken).get('/api/v1/me').expect(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    await http().post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
  });

  it('enrolls MFA, requires a second factor and accepts single-use recovery codes', async () => {
    const { email } = await makeUser('mfa');
    const tokens = await login(app, email, DEMO_PASSWORD);
    const client = asBearer(app, tokens.accessToken);
    const enroll = await client.post('/api/v1/auth/mfa/enroll').expect(200);
    const secret = enroll.body.data.secret as string;
    expect(enroll.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    await client.post('/api/v1/auth/mfa/activate', { code: '000000' }).expect(400);
    const activated = await client
      .post('/api/v1/auth/mfa/activate', { code: totp(secret) })
      .expect(200);
    const recoveryCodes = activated.body.data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const step1 = await login(app, email, DEMO_PASSWORD);
    expect(step1.mfaRequired).toBe(true);
    expect(step1.accessToken).toBeUndefined();

    // The activation code was already used in this time step: replay is refused.
    const replay = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: step1.mfaToken, code: totp(secret) })
      .expect(401);
    expect(replay.body.error.code).toBe('MFA_INVALID');

    const viaRecovery = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: step1.mfaToken, recoveryCode: recoveryCodes[0] })
      .expect(200);
    expect(viaRecovery.body.data.accessToken).toBeTruthy();

    const step2 = await login(app, email, DEMO_PASSWORD);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: step2.mfaToken, recoveryCode: recoveryCodes[0] })
      .expect(401);

    const me = await asBearer(app, viaRecovery.body.data.accessToken).get('/api/v1/me');
    expect(me.body.data.user.mfaEnabled).toBe(true);
  });

  it('changes password with policy enforcement and revokes other sessions', async () => {
    const { email } = await makeUser('pwchange');
    const a = await login(app, email, DEMO_PASSWORD);
    const b = await login(app, email, DEMO_PASSWORD);
    const weak = await asBearer(app, a.accessToken)
      .post('/api/v1/auth/password/change', {
        currentPassword: DEMO_PASSWORD,
        newPassword: 'short',
      })
      .expect(400);
    expect(JSON.stringify(weak.body.error)).toContain('PASSWORD_POLICY');
    await asBearer(app, a.accessToken)
      .post('/api/v1/auth/password/change', {
        currentPassword: DEMO_PASSWORD,
        newPassword: 'Another-Passw0rd!',
      })
      .expect(204);
    await asBearer(app, a.accessToken).get('/api/v1/me').expect(200);
    await asBearer(app, b.accessToken).get('/api/v1/me').expect(401);
    await login(app, email, 'Another-Passw0rd!');
  });

  it('invites a user who accepts and signs in; admin-issued reset works once', async () => {
    const owner = await login(app, 'owner@abbs.test', DEMO_PASSWORD);
    const admin = asBearer(app, owner.accessToken);
    const roles = await admin.get('/api/v1/roles?pageSize=100').expect(200);
    const teacher = roles.body.data.find((r: { key: string }) => r.key === 'teacher');
    const email = `invitee-${Date.now()}@abbs.test`;
    const created = await admin
      .post('/api/v1/users', {
        email,
        name: 'Invited Teacher',
        roles: [{ roleId: teacher.id, scopes: [{ type: 'ORGANIZATION' }] }],
      })
      .expect(201);
    expect(created.body.data.membershipStatus).toBe('INVITED');
    // Tokens are never returned by the API; they are e-mailed (log provider outbox in tests).
    expect(created.body.data.inviteToken).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toMatch(/token=/);
    const inviteToken = tokenFromOutbox(email, 'accept-invite');

    await http()
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: 'Teacher-Passw0rd!' })
      .expect(204);
    await http()
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: 'Teacher-Passw0rd!' })
      .expect(400);
    const teacherLogin = await login(app, email, 'Teacher-Passw0rd!');
    const me = await asBearer(app, teacherLogin.accessToken).get('/api/v1/me').expect(200);
    expect(me.body.data.roles[0].key).toBe('teacher');

    const reset = await admin
      .post(`/api/v1/users/${created.body.data.id}/password-reset`)
      .expect(201);
    expect(reset.body.data.resetToken).toBeUndefined();
    expect(reset.body.data.deliveryStatus).toBe('SENT');
    const resetToken = tokenFromOutbox(email, 'reset-password');
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token: resetToken, newPassword: 'Reset-Passw0rd!' })
      .expect(204);
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token: resetToken, newPassword: 'Reset-Passw0rd!' })
      .expect(400);
    // Reset revokes existing sessions.
    await asBearer(app, teacherLogin.accessToken).get('/api/v1/me').expect(401);
    await login(app, email, 'Reset-Passw0rd!');
  });

  it('forgot-password e-mails a reset link without revealing whether the account exists', async () => {
    const { email } = await makeUser('forgot');
    const before = messageOutbox.length;
    await http()
      .post('/api/v1/auth/password/forgot')
      .send({ email: `nobody-${Date.now()}@abbs.test` })
      .expect(204);
    expect(messageOutbox.length).toBe(before);
    await http()
      .post('/api/v1/auth/password/forgot')
      .send({ email, organizationId: 'x' })
      .expect(400);
    await http()
      .post('/api/v1/auth/password/forgot')
      .send({ email: email.toUpperCase() })
      .expect(204);
    const token = tokenFromOutbox(email, 'reset-password');
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'Forgot-Passw0rd!' })
      .expect(204);
    await login(app, email, 'Forgot-Passw0rd!');
  });

  it('deactivated members cannot sign in and lose their sessions', async () => {
    const owner = asBearer(app, (await login(app, 'owner@abbs.test', DEMO_PASSWORD)).accessToken);
    const { email, id } = await makeUser('deactivate');
    const tokens = await login(app, email, DEMO_PASSWORD);
    await owner.post(`/api/v1/users/${id}/deactivate`).expect(200);
    await asBearer(app, tokens.accessToken).get('/api/v1/groups').expect(401);
    const res = await http().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('requires a valid token for tenant routes in jwt mode', async () => {
    const res = await supertest(app).get('/api/v1/groups').set('Authorization', 'Bearer x.y.z');
    expect(res.status).toBe(401);
  });
});

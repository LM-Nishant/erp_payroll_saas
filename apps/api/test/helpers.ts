import supertest from 'supertest';
import type { createApp } from '../src/app';
import { DEV_TENANT_HEADER } from '../src/core/tenancy';

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

/** HTTP client acting as the given tenant (via the dev-header stub resolver). */
export function asTenant(app: ReturnType<typeof createApp>, organization: string) {
  const agent = supertest(app);
  return {
    get: (url: string) => agent.get(url).set(DEV_TENANT_HEADER, organization),
    post: (url: string, body: object) =>
      agent.post(url).set(DEV_TENANT_HEADER, organization).send(body),
    patch: (url: string, body: object) =>
      agent.patch(url).set(DEV_TENANT_HEADER, organization).send(body),
    delete: (url: string) => agent.delete(url).set(DEV_TENANT_HEADER, organization),
  };
}

/** Generous limits so tests are not throttled (the rate-limit test opts into a tiny limit). */
export const TEST_AUTH_RATE_LIMIT = { windowMs: 60_000, max: 10_000 };

/** Sign in through the real auth endpoint and return the body-delivered tokens. */
export async function login(
  app: ReturnType<typeof createApp>,
  email: string,
  password: string,
  organization?: string,
) {
  const res = await supertest(app)
    .post('/api/v1/auth/login')
    .send({ email, password, ...(organization ? { organization } : {}) })
    .expect(200);
  return res.body.data as {
    accessToken: string;
    refreshToken: string;
    mfaRequired: boolean;
    mfaToken?: string;
  };
}

/** HTTP client authenticated with a bearer access token. */
export function asBearer(app: ReturnType<typeof createApp>, accessToken: string) {
  const agent = supertest(app);
  const auth = `Bearer ${accessToken}`;
  return {
    get: (url: string) => agent.get(url).set('Authorization', auth),
    post: (url: string, body: object = {}) => agent.post(url).set('Authorization', auth).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('Authorization', auth).send(body),
    put: (url: string, body: object) => agent.put(url).set('Authorization', auth).send(body),
    delete: (url: string) => agent.delete(url).set('Authorization', auth),
  };
}

/** Sign in and return a bearer client. */
export async function signIn(
  app: ReturnType<typeof createApp>,
  email: string,
  password: string,
  organization?: string,
) {
  const tokens = await login(app, email, password, organization);
  return asBearer(app, tokens.accessToken);
}

export const DEMO_PASSWORD = 'Demo-Passw0rd!';

/** Seed the demo organizations, default roles and demo users (idempotent). */
export async function seedAccessFixture() {
  const { prisma } = await import('../src/core/db/prisma');
  const { seedDemoData } = await import('../prisma/seed-data');
  const { seedAccessControl } = await import('../prisma/seed-access');
  const orgIds = await seedDemoData(prisma);
  const userIds = await seedAccessControl(prisma, orgIds, { password: DEMO_PASSWORD });
  return { orgIds, userIds };
}

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

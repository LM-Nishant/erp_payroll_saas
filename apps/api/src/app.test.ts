import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import {
  denyAllTenantResolver,
  type OrganizationLookup,
  type TenantResolver,
} from './core/tenancy';

const lookup: OrganizationLookup = {
  findById: vi.fn(async (id: string) =>
    id === 'suspended' ? { id, slug: id, status: 'SUSPENDED' as const } : null,
  ),
  findBySlug: vi.fn(async () => null),
};

function app(resolver: TenantResolver = denyAllTenantResolver) {
  return createApp({
    organizationLookup: lookup,
    tenantResolver: resolver,
    readinessCheck: async () => undefined,
  });
}

describe('HTTP foundation (no database)', () => {
  it('serves liveness and readiness', async () => {
    const res = await supertest(app()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    await supertest(app()).get('/health/ready').expect(200);
  });

  it('reports not-ready when the readiness check fails', async () => {
    const failing = createApp({
      organizationLookup: lookup,
      tenantResolver: denyAllTenantResolver,
      readinessCheck: async () => {
        throw new Error('db down');
      },
    });
    await supertest(failing).get('/health/ready').expect(503);
  });

  it('generates a request id and echoes safe inbound ids', async () => {
    const generated = await supertest(app()).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await supertest(app()).get('/health').set('X-Request-Id', 'gw-123');
    expect(echoed.headers['x-request-id']).toBe('gw-123');
    const unsafe = await supertest(app()).get('/health').set('X-Request-Id', 'bad id<script>');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id<script>');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await supertest(app()).get('/nope').expect(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects tenant-scoped routes when the tenant cannot be resolved', async () => {
    const res = await supertest(app()).get('/api/v1/groups').expect(401);
    expect(res.body.error.code).toBe('TENANT_UNRESOLVED');
  });

  it('rejects organizations that are not active', async () => {
    const resolver: TenantResolver = {
      name: 'fixed',
      resolve: async () => ({ organizationId: 'suspended' }),
    };
    const res = await supertest(app(resolver)).get('/api/v1/groups').expect(403);
    expect(res.body.error.code).toBe('TENANT_INACTIVE');
  });

  it('rejects client-supplied tenant identifiers before resolving the tenant', async () => {
    const res = await supertest(app())
      .post('/api/v1/groups')
      .send({ organizationId: 'x', name: 'n', code: 'c' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await supertest(app())
      .post('/api/v1/groups')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body.error.message).toBe('Malformed JSON body');
  });
});
